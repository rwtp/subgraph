import {
  Address,
  log,
  BigInt,
  ipfs,
  json,
} from "@graphprotocol/graph-ts";
import {
  OfferSubmitted,
  OfferCanceled,
  OfferCommitted,
  OfferConfirmed,
  OfferEnforced,
  OfferWithdrawn,
} from "../generated/templates/SellOrder/SellOrder";
import { SellOrder as SellOrderContract } from "../generated/templates/SellOrder/SellOrder";
import { Offer, SellOrder, OfferTransition } from "../generated/schema";
import { getEntryString } from "./entrySafeUnwrap";

function getOffer(
  buyer: Address,
  index: BigInt,
  sellOrderAddress: Address
): Offer {
  const offerId =
    buyer.toHex() + "-" + index.toString() + "-" + sellOrderAddress.toHex();
  let entity = Offer.load(offerId);
  if (!entity) {
    entity = new Offer(offerId);
    entity.history = [];
  }
  return entity;
}

function getOfferTransition(
  buyer: Address,
  index: BigInt,
  transaction_hash: string
): OfferTransition {
  const offerId =
    buyer.toHex() + "-" + index.toString() + "-" + transaction_hash;
  let entity = OfferTransition.load(offerId);
  if (!entity) {
    entity = new OfferTransition(offerId);
  } else {
    log.error("This should not be possible", []);
  }
  return entity;
}

const STATE_MAP = ["Closed", "Open", "Committed"];


// Sorry this function is long I will clean up i promise :) 
function updateOfferState(
  sellOrderAddress: Address | null,
  buyer: Address,
  index: BigInt,
  timestamp: BigInt,
  transactionHash: string,
  event: string
): void {
  if (sellOrderAddress === null) {
    log.error("Seller address is null", []);
    return;
  }

  const offerEntity = getOffer(buyer, index, sellOrderAddress);

  log.info("updateOfferState: {} {} {} {} {}", [
    sellOrderAddress.toHex(),
    buyer.toHex(),
    index.toString(),
    timestamp.toString(),
    transactionHash,
  ]);


  let sellOrder = SellOrder.load(sellOrderAddress.toHex());
  if (!sellOrder) {
    log.error("Sell order not found. This should be impossible", []);
    return;
  }
  let sellOrderContract = SellOrderContract.bind(sellOrderAddress);

  let tryOfferFromContract = sellOrderContract.try_offers(buyer, index);
  if (tryOfferFromContract.reverted) {
    log.error("Offer not found. This should be impossible", []);
    return
  }
  let offerFromContract = tryOfferFromContract.value;
  const state = offerFromContract.value0;
  const pricePerUnit = offerFromContract.value1;
  const stakePerUnit = offerFromContract.value2;
  const uri = offerFromContract.value3;
  const acceptedAt = offerFromContract.value4;
  const sellerCanceled = offerFromContract.value5;
  const buyerCanceled = offerFromContract.value6;
  const quantity = offerFromContract.value7;


  if (state > STATE_MAP.length) {
    log.error("Invalid state: {}", [state.toString()]);
    return;
  }

  let newState = "";
  let closed = STATE_MAP[state] === "Closed";
  if (
    closed &&
    (event === "OfferCanceled") &&
    sellerCanceled && buyerCanceled
  ) {
    newState = "Canceled";
  } else if (closed) {
    if (event === "OfferEnforced") {
      newState = "Enforced";
    } else if (event === "OfferWithdrawn") {
      newState = "Withdrawn";
    } else if (event === "OfferConfirmed") {
      newState = "Confirmed";
    } else if (event === "OfferEnforced") {
      newState = "Enforced";
    }
  } else {
    newState = STATE_MAP[state];
  }


  offerEntity.state = newState;
  offerEntity.seller = sellOrder.seller;
  offerEntity.buyer = buyer;
  offerEntity.index = index;
  offerEntity.pricePerUnit = pricePerUnit;
  offerEntity.quantity = quantity;
  offerEntity.stakePerUnit = stakePerUnit;
  offerEntity.uri = uri;
  offerEntity.timestamp = timestamp;
  offerEntity.acceptedAt = acceptedAt;
  offerEntity.sellerCanceled = sellerCanceled;
  offerEntity.buyerCanceled = buyerCanceled;

  // Get offer metadata from IPFS
  const cid = uri.replace("ipfs://", "");
  let data = ipfs.cat(cid);
  if (!data) {
    sellOrder.error = `IPFS data not found for ${cid}`;
    log.warning("Unable to get data at: {}", [cid]);
    return;
  }
  const tryValue = json.try_fromBytes(data);
  const typedMap = tryValue.value.toObject();
  if (!typedMap) {
    sellOrder.error = `invalid IPFS data for ${cid}`;
    log.warning("Unable to parse data at: {}", [cid]);
    return;
  }
  log.info("Parsing data at {}", [cid]);
  offerEntity.messagePublicKey = getEntryString(typedMap, "buyersPublicKey");
  offerEntity.messageNonce = getEntryString(typedMap, "nonce");
  offerEntity.message = getEntryString(typedMap, "message");

  let offerTransition = getOfferTransition(buyer, index, transactionHash);
  offerTransition.buyerCanceled = buyerCanceled;
  offerTransition.sellerCanceled = sellerCanceled;
  offerTransition.state = newState;
  offerTransition.timestamp = timestamp;
  offerTransition.save();
  offerEntity.history = offerEntity.history.concat([offerTransition.id]);
  offerEntity.sellOrder = sellOrder.id;
  offerEntity.save();
  if (!sellOrder.offers.includes(offerEntity.id)) {
    sellOrder.offers = sellOrder.offers.concat([offerEntity.id]);
    sellOrder.offerCount = BigInt.fromI64(sellOrder.offers.length);
    sellOrder.save();
  }
}

export function handleOfferCanceled(event: OfferCanceled): void {
  updateOfferState(
    event.transaction.to,
    event.params.buyer,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    "OfferCanceled"
  );
}
export function handleOfferCommitted(event: OfferCommitted): void {
  updateOfferState(
    event.transaction.to,
    event.params.buyer,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    "OfferCommitted"
  );
}
export function handleOfferConfirmed(event: OfferConfirmed): void {
  updateOfferState(
    event.transaction.to,
    event.params.buyer,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    "OfferConfirmed"
  );
}
export function handleOfferEnforced(event: OfferEnforced): void {
  updateOfferState(
    event.transaction.to,
    event.params.buyer,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    "OfferEnforced"
  );
}
export function handleOfferWithdrawn(event: OfferWithdrawn): void {
  updateOfferState(
    event.transaction.to,
    event.params.buyer,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    "OfferWithdrawn"
  );
}

export function handleOfferSubmitted(event: OfferSubmitted): void {
  updateOfferState(
    event.transaction.to,
    event.params.buyer,
    event.params.index,
    event.block.timestamp,
    event.transaction.hash.toHex(),
    "OfferSubmitted"
  );
}

// export function handleOrderURIChanged(event: OrderURIChanged): void {

// }
