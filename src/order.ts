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
  OrderURIChanged,
} from "../generated/templates/Order/Order";
import { Order as OrderContract } from "../generated/templates/Order/Order";
import { Offer, Order, OfferTransition, Token, OrderTransition } from "../generated/schema";
import { getEntryString } from "./entrySafeUnwrap";
import { ERC20 } from "../generated/OrderBook/ERC20";
import {loadOrderIPFSMetaData} from './orderBook';

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
  offerBuilder: OfferBuilder
): OfferTransition {
  const offerId =
  offerBuilder.taker.toHex() + "-" + offerBuilder.index.toString() + "-" + offerBuilder.transactionHash;
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
  offerBuilder: OfferBuilder
): Offer | null {
  let orderContract = OrderContract.bind(orderAddress);

  // Load on chain offer state
  let tryOfferFromContract = orderContract.try_offers(offerBuilder.taker, offerBuilder.index);
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
  offerEntity.state = getOfferState(offerBuilder.event, state);
  offerEntity.contractState = STATE_MAP[state];
  if (offerEntity.contractState !== "Closed") {
    offerEntity.tokenAddress = tokenAddress;
    offerEntity = load_erc20_data(tokenAddress, offerEntity);
    offerEntity.taker = offerBuilder.taker;
    offerEntity.index = offerBuilder.index;
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
  offerBuilder: OfferBuilder
): Offer | null {
  offerEntity.timestamp = offerBuilder.timestamp;
  let offer = loadOfferDataFromContract(orderAddress, offerEntity, offerBuilder);
  if (!offer) {
    return null;
  }
  offer = loadOfferIPFSData(offer);
  return offer;
}

function getOrder(orderAddress: Address | null) : Order | null {
  if (orderAddress === null) {
    log.error("Seller address is null", []);
    return null;
  }

  // Load order entity
  return Order.load(orderAddress.toHex());

}
class offerStates {
  constructor(
    public offer: Offer,
    public offerTransition: OfferTransition,
    public order: Order,
  ) {}
  
}
class OfferBuilder {
  constructor(
    public orderAddress: Address | null,
    public taker: Address,
    public index: BigInt,
    public timestamp: BigInt,
    public transactionHash: string,
    public event: Event,
  ) {}
}
function buildOfferStates(
  offerBuilder: OfferBuilder
): offerStates | null {
  let order = getOrder(offerBuilder.orderAddress);
  if (!order) {
    log.error("Sell order not found. This should be impossible", []);
    return null ;
  }
  let offer = getOffer(offerBuilder.taker, offerBuilder.index, Address.fromBytes(order.address));
  let offerEntity = loadAllOfferData(Address.fromBytes(order.address), offer, offerBuilder);
  if (!offerEntity) {
    return null;
  }

  let offerTransition = getOfferTransition(offerBuilder);
  offerTransition = loadTransitionData(offerTransition, offerEntity, offerBuilder.timestamp);
  offerEntity.history = offerEntity.history.concat([offerTransition.id]);
  offerEntity.order = order.id;
  offerEntity.maker = order.maker;
  if (!order.offers.includes(offerEntity.id)) {
    order.offers = order.offers.concat([offerEntity.id]);
    order.offerCount = BigInt.fromI64(order.offers.length);
  }
  return new offerStates(
    offer,
    offerTransition,
    order,
  );
}

function updateOfferState(
  offerBuilder: OfferBuilder
): void {
  const offerStates = buildOfferStates(offerBuilder);
  if (!offerStates) {
    return;
  }
  

  if (offerStates.offer.contractState === "Closed") {
    store.remove('Offer', offerStates.offer.id);
    offerStates.offer.id = offerStates.offer.id + `-closed-${offerBuilder.transactionHash}`;
  }

  offerStates.offerTransition.save();
  offerStates.offer.save();
  offerStates.offer.save();
}


export function handleOrderURIChanged(event: OrderURIChanged): void {
  let orderAddress = event.transaction.to;
  if (!orderAddress) {
    log.warning("orderAddress null when URI changed", []);
    return;
  }
  let order = Order.load(orderAddress.toHex());
  if (!order) {
    log.warning("order null when URI changed", []);
    return;
  }
  let transactionHash = event.transaction.hash.toHex();

  let currentOrderId = order.id;
  let oldOrderId = currentOrderId + '-' + transactionHash;
  order.isCurrent = false;
  order.id = oldOrderId
  order.save()
  

  order.isCurrent = true;
  let uriTransition = new OrderTransition(transactionHash);
  order.history = order.history.concat([uriTransition.id])

  uriTransition.timestamp = event.block.timestamp;
  uriTransition.order = oldOrderId;
  order.id = currentOrderId;
  order = loadOrderIPFSMetaData(event.params.next, order);
  uriTransition.save();
  order.save();

}

export function handleOfferCanceled(event: OfferCanceled): void {
  const offerBuilder = new OfferBuilder (
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferCanceled,
  );
  const offerStates = buildOfferStates(offerBuilder);
  if (!offerStates) {
    return;
  }

  if (event.params.makerCanceled === false && event.params.takerCanceled === false) {
    offerStates.offer.takerCanceled = true;
    offerStates.offer.makerCanceled = true;
    offerStates.offer.state = "Canceled";
    store.remove('Offer', offerStates.offer.id);
    offerStates.offer.id = offerStates.offer.id + `-closed-${offerBuilder.transactionHash}`;
  } else if (offerStates.offer.contractState === "Closed") {
    // Handles a strange edge case where both the maker and taker cancel on the same block.
    // Causing one but not both to be true and the state to be closed.
    // We are able to take advantage of the fact that you can only ever set cancel and not unset.
    // If we implement un-setting cancel, we will need to reevaluate this function. Probably to
    // just ensure that either takerCanceled or makerCanceled is set.
    offerStates.offer.contractState = "Committed";
    offerStates.offer.state = "Committed";
  }
  
  offerStates.offerTransition.save();
  offerStates.offer.save();
  offerStates.offer.save();

}
export function handleOfferCommitted(event: OfferCommitted): void {
  updateOfferState(new OfferBuilder(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferCommitted,
  ));
}
export function handleOfferConfirmed(event: OfferConfirmed): void {
  updateOfferState(new OfferBuilder(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferConfirmed,
  ));
}
export function handleOfferRefunded(event: OfferRefunded): void {
  updateOfferState(new OfferBuilder(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferRefunded,
  ));
}
export function handleOfferWithdrawn(event: OfferWithdrawn): void {
  updateOfferState(new OfferBuilder(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferWithdrawn,
  ));
}

export function handleOfferSubmitted(event: OfferSubmitted): void {
  updateOfferState(new OfferBuilder(
    event.transaction.to,
    event.params.taker,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    Event.OfferSubmitted,
  ));
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

