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
  orderAddress: Address,
  closedAt: BigInt
): Offer {
  const offerId =
    `${taker.toHex()}-${index.toString()}-${orderAddress.toHex()}-${closedAt.toString()}`;
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


// Sorry this function is long I will clean up i promise :) 
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
  let orderContract = OrderContract.bind(orderAddress);

  // Load on chain offer state
  let tryOfferFromContract = orderContract.try_offers(taker, index);
  if (tryOfferFromContract.reverted) {
    log.error("Offer not found. This should be impossible", []);
    return
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
    return;
  }

  log.info("updateOfferState: {} {} {} {} {} {}", [
    orderAddress.toHex(),
    taker.toHex(),
    index.toString(),
    timestamp.toString(),
    transactionHash,
    event.toString()
  ]);

  let offerEntity: Offer;
  if (STATE_MAP[state] == "Closed") {
    // Create new closed offer with state and remove old offer
    offerEntity = getOffer(taker, index, orderAddress, timestamp);
    const oldOfferEntity = getOffer(taker, index, orderAddress, BigInt.fromI32(0));
    switch (event) {
      case Event.OfferConfirmed:
        offerEntity.state = "Confirmed";
        break;
      case Event.OfferRefunded:
        offerEntity.state = "Refunded";
        break;
      case Event.OfferWithdrawn:
        offerEntity.state = "Withdrawn";
        break;
      default:
        offerEntity.state = "Closed";
        break;
    }
    offerEntity.taker = oldOfferEntity.taker;
    offerEntity.index = oldOfferEntity.index;
    offerEntity.tokenAddress = oldOfferEntity.tokenAddress;
    offerEntity.token = oldOfferEntity.token
    offerEntity.price = oldOfferEntity.price;
    offerEntity.buyersCost = oldOfferEntity.buyersCost;
    offerEntity.sellersStake = oldOfferEntity.sellersStake;
    offerEntity.timeout = oldOfferEntity.timeout;
    offerEntity.uri = oldOfferEntity.uri;
    offerEntity.timestamp = oldOfferEntity.timestamp;
    offerEntity.acceptedAt = oldOfferEntity.acceptedAt;
    offerEntity.makerCanceled = oldOfferEntity.makerCanceled;
    offerEntity.takerCanceled = oldOfferEntity.takerCanceled;
    offerEntity.messagePublicKey = oldOfferEntity.messagePublicKey;
    offerEntity.messageNonce = oldOfferEntity.messageNonce;
    offerEntity.message = oldOfferEntity.message;
    // Delete the old offer
    store.remove("Offer", oldOfferEntity.id);
  } else {
    offerEntity = getOffer(taker, index, orderAddress, BigInt.fromI32(0));
    offerEntity.state = STATE_MAP[state];
    offerEntity.taker = taker;
    offerEntity.index = index;
    offerEntity.tokenAddress = tokenAddress;
    offerEntity = load_erc20_data(tokenAddress, offerEntity);
    offerEntity.price = price;
    offerEntity.buyersCost = buyersCost;
    offerEntity.sellersStake = sellersStake;
    offerEntity.timeout = timeout;
    offerEntity.uri = uri;
    offerEntity.timestamp = timestamp;
    offerEntity.acceptedAt = acceptedAt;
    offerEntity.makerCanceled = makerCanceled;
    offerEntity.takerCanceled = takerCanceled;
    // Get offer metadata from IPFS
    const cid = uri.replace("ipfs://", "");
    let data = ipfs.cat(cid);
    if (!data) {
      order.error = `IPFS data not found for ${cid}`;
      log.warning("Unable to get data at: {}", [cid]);
      return;
    }
    const tryValue = json.try_fromBytes(data);
    const typedMap = tryValue.value.toObject();
    if (!typedMap) {
      order.error = `invalid IPFS data for ${cid}`;
      log.warning("Unable to parse data at: {}", [cid]);
      return;
    }
    log.info("Parsing data at {}", [cid]);
    offerEntity.messagePublicKey = getEntryString(typedMap, "publicKey");
    offerEntity.messageNonce = getEntryString(typedMap, "nonce");
    offerEntity.message = getEntryString(typedMap, "message");
  }

  // let offerTransition = getOfferTransition(taker, index, transactionHash);
  // offerTransition.takerCanceled = takerCanceled;
  // offerTransition.makerCanceled = makerCanceled;
  // offerTransition.state = STATE_MAP[state];
  // offerTransition.timestamp = timestamp;
  // offerTransition.save();
  // offerEntity.history = offerEntity.history.concat([offerTransition.id]);
  offerEntity.order = order.id;
  offerEntity.save();
  if (!order.offers.includes(offerEntity.id)) {
    order.offers = order.offers.concat([offerEntity.id]);
    order.offerCount = BigInt.fromI64(order.offers.length);
    order.save();
  }
}

export function handleOfferCanceled(event: OfferCanceled): void {
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
    tokenEntity.name = tokenContract.name();
    tokenEntity.symbol = tokenContract.symbol();
    tokenEntity.decimals = BigInt.fromI32(tokenContract.decimals());
    tokenEntity.totalSupply = tokenContract.totalSupply();
    tokenEntity.save();
    offer.token = tokenEntity.id;
  }
  return offer;
}

// export function handleOrderURIChanged(event: OrderURIChanged): void {

// }
