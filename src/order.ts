import {
  Address,
  log,
  BigInt,
  ipfs,
  json,
  store
} from "@graphprotocol/graph-ts";
import {
  OfferSubmitted,
  OfferCanceled,
  OfferCommitted,
  OfferConfirmed,
  OfferRefunded,
  OfferWithdrawn,
} from "../generated/templates/Order/Order";
import { Order as OrderContract } from "../generated/templates/Order/Order";
import { Offer, Order, OfferTransition, Token } from "../generated/schema";
import { getEntryString } from "./entrySafeUnwrap";
import { ERC20 } from "../generated/OrderBook/ERC20";

// TODO: Add in timestamp or something incase the same person orders the same thing twice
function getOffer(
  taker: Address,
  index: BigInt,
  orderAddress: Address
): Offer {
  const offerId =
    `${taker.toHex()}-${index.toString()}-${orderAddress.toHex()}`;
  let entity = Offer.load(offerId);
  if (!entity) {
    entity = new Offer(offerId);
    entity.history = [];
  }
  return entity;
}

function getOfferTransition(
  taker: Address,
  index: BigInt,
  transaction_hash: string
): OfferTransition {
  const offerId =
    taker.toHex() + "-" + index.toString() + "-" + transaction_hash;
  let entity = OfferTransition.load(offerId);
  if (!entity) {
    entity = new OfferTransition(offerId);
  } else {
    log.error("This should not be possible", []);
  }
  return entity;
}

const STATE_MAP = ["Closed", "Open", "Committed"];

enum Event {
  OfferSubmitted,
  OfferCanceled,
  OfferCommitted,
  OfferConfirmed,
  OfferRefunded,
  OfferWithdrawn,
}

function getOfferState(
  event: Event,
  state: i32,
): string {
  switch (event) {
    case Event.OfferConfirmed:
      return "Confirmed";
    case Event.OfferRefunded:
      return "Refunded";
    case Event.OfferWithdrawn:
      return "Withdrawn";
    default:
      return STATE_MAP[state];
  }
}

function loadOfferDataFromContract(
  orderAddress: Address,
  offerEntity: Offer,
  taker: Address,
  index: BigInt,
  event: Event,
): Offer | null {
  let orderContract = OrderContract.bind(orderAddress);

  // Load on chain offer state
  let tryOfferFromContract = orderContract.try_offers(taker, index);
  if (tryOfferFromContract.reverted) {
    log.error("Offer not found. This should be impossible", []);
    return null;
  }
  let offerFromContract = tryOfferFromContract.value;
  const state = offerFromContract.value0;
  const tokenAddress: Address = offerFromContract.value1;
  const price: BigInt = offerFromContract.value2;
  const buyersCost: BigInt = offerFromContract.value3;
  const sellersStake: BigInt = offerFromContract.value4;
  const timeout: BigInt = offerFromContract.value5;
  const uri: string = offerFromContract.value6;
  const acceptedAt: BigInt = offerFromContract.value7;
  const makerCanceled = offerFromContract.value8;
  const takerCanceled = offerFromContract.value9;
  if (state >= STATE_MAP.length) {
    log.error("Invalid state: {}", [state.toString()]);
    return null;
  }
  offerEntity.state = getOfferState(event, state);
  offerEntity.contractState = STATE_MAP[state];
  if (offerEntity.contractState !== "Closed") {
    offerEntity.tokenAddress = tokenAddress;
    offerEntity = load_erc20_data(tokenAddress, offerEntity);
    offerEntity.taker = taker;
    offerEntity.index = index;
    offerEntity.price = price;
    offerEntity.buyersCost = buyersCost;
    offerEntity.sellersStake = sellersStake;
    offerEntity.timeout = timeout;
    offerEntity.uri = uri;
    offerEntity.acceptedAt = acceptedAt;
    offerEntity.makerCanceled = makerCanceled;
    offerEntity.takerCanceled = takerCanceled;
  }
  return offerEntity;
}

function loadOfferIPFSData(offerEntity: Offer): Offer | null {
  const cid = offerEntity.uri.replace("ipfs://", "");
  let data = ipfs.cat(cid);
  if (!data) {
    log.warning("Unable to get data at: {}", [cid]);
    return null;
  }
  const tryValue = json.try_fromBytes(data);
  const typedMap = tryValue.value.toObject();
  if (!typedMap) {
    log.warning("Unable to parse data at: {}", [cid]);
    return null;
  }
  log.info("Parsing data at {}", [cid]);
  offerEntity.messagePublicKey = getEntryString(typedMap, "publicKey");
  offerEntity.messageNonce = getEntryString(typedMap, "nonce");
  offerEntity.message = getEntryString(typedMap, "message");
  return offerEntity;
}

function loadTransitionData(
  offerTransition: OfferTransition,
  offerEntity: Offer,
  timestamp: BigInt,
): OfferTransition {
  offerTransition.takerCanceled = offerEntity.takerCanceled;
  offerTransition.makerCanceled = offerEntity.makerCanceled;
  offerTransition.state = offerEntity.state;
  offerTransition.timestamp = timestamp;
  return offerTransition;
}

function loadAllOfferData(
  orderAddress: Address,
  offerEntity: Offer,
  taker: Address,
  index: BigInt,
  event: Event,
  timestamp: BigInt,
): Offer | null {
  offerEntity.timestamp = timestamp;
  let offer = loadOfferDataFromContract(orderAddress, offerEntity, taker, index, event);
  if (!offer) {
    return null;
  }
  offer = loadOfferIPFSData(offer);
  return offer;
}

function updateOfferState(
  orderAddress: Address | null,
  taker: Address,
  index: BigInt,
  timestamp: BigInt,
  transactionHash: string,
  event: Event
): void {
  if (orderAddress === null) {
    log.error("Seller address is null", []);
    return;
  }

  // Load order entity
  let order = Order.load(orderAddress.toHex());
  if (!order) {
    log.error("Sell order not found. This should be impossible", []);
    return;
  }
  let offer = getOffer(taker, index, orderAddress);
  let offerEntity = loadAllOfferData(orderAddress, offer, taker, index, event, timestamp);
  if (!offerEntity) {
    return;
  }

  if (offerEntity.contractState === "Closed") {
    store.remove('Offer', offerEntity.id);
    offerEntity.id = offerEntity.id + `-closed-${transactionHash}`;
  }


  let offerTransition = getOfferTransition(taker, index, transactionHash);
  offerTransition = loadTransitionData(offerTransition, offerEntity, timestamp);
  offerTransition.save();
  offerEntity.history = offerEntity.history.concat([offerTransition.id]);
  offerEntity.order = order.id;
  offerEntity.maker = order.maker;
  offerEntity.save();
  if (!order.offers.includes(offerEntity.id)) {
    order.offers = order.offers.concat([offerEntity.id]);
    order.offerCount = BigInt.fromI64(order.offers.length);
    order.save();
  }
}

export function handleOfferCanceled(event: OfferCanceled): void {
  if (event.params.takerCanceled) {
    return;
  }
  updateOfferState(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferCanceled
  );
}
export function handleOfferCommitted(event: OfferCommitted): void {
  updateOfferState(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferCommitted
  );
}
export function handleOfferConfirmed(event: OfferConfirmed): void {
  updateOfferState(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferConfirmed
  );
}
export function handleOfferRefunded(event: OfferRefunded): void {
  updateOfferState(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferRefunded
  );
}
export function handleOfferWithdrawn(event: OfferWithdrawn): void {
  updateOfferState(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferWithdrawn
  );
}

export function handleOfferSubmitted(event: OfferSubmitted): void {
  updateOfferState(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferSubmitted
  );
}


function load_erc20_data(
  tokenAddress: Address,
  offer: Offer
): Offer {
  offer.tokenAddress = tokenAddress;
  let tokenEntity = Token.load(tokenAddress.toHex());
  if (!tokenEntity) {
    tokenEntity = new Token(tokenAddress.toHex());
  }
  tokenEntity.address = tokenAddress;
  let tokenContract = ERC20.bind(tokenAddress);
  if (!tokenContract) {
    log.warning("Unable to get ERC20 contract at: {}", [tokenAddress.toHex()]);
    return offer;
  } else {
    let name = tokenContract.try_name();
    if (name.reverted) {
      log.warning("Unable to get ERC20 name at: {}", [tokenAddress.toHex()]);
      return offer;
    } else {
      tokenEntity.name = name.value;
    }
    let symbol = tokenContract.try_symbol();
    if (symbol.reverted) {
      log.warning("Unable to get ERC20 symbol at: {}", [tokenAddress.toHex()]);
      return offer;
    } else {
      tokenEntity.symbol = symbol.value;
    }
    let decimals = tokenContract.try_decimals();
    if (decimals.reverted) {
      log.warning("Unable to get ERC20 decimals at: {}", [tokenAddress.toHex()]);
      return offer;
    } else {
      tokenEntity.decimals = BigInt.fromI32(decimals.value);
    }
    let totalSupply = tokenContract.try_totalSupply();
    if (totalSupply.reverted) {
      log.warning("Unable to get ERC20 totalSupply at: {}", [tokenAddress.toHex()]);
      return offer;
    } else {
      tokenEntity.totalSupply = totalSupply.value;
    }
    tokenEntity.save();
    offer.token = tokenEntity.id;
  }
  return offer;
}

// export function handleOrderURIChanged(event: OrderURIChanged): void {

// }
