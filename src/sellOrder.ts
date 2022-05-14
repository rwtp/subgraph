import {
  Address,
  log,
  BigInt,
  TypedMap,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  OfferSubmitted,
  OfferCanceled,
  OfferCommitted,
  OfferConfirmed,
  OfferEnforced,
  OfferWithdrawn,
  OrderURIChanged,
} from "../generated/templates/SellOrder/SellOrder";
import { SellOrder as SellOrderContract } from "../generated/templates/SellOrder/SellOrder";
import { Offer, SellOrder, OfferSentinel } from "../generated/schema";

function getOffer(
  buyer: Address,
  index: BigInt,
  transaction_hash: string
): Offer {
  const offerId =
    buyer.toHex() + "-" + index.toString() + "-" + transaction_hash;
  let entity = Offer.load(offerId);
  if (!entity) {
    entity = new Offer(offerId);
  }
  return entity;
}

function getOfferSentinel(
  buyer: Address,
  index: BigInt,
  sellOrder: Address
): OfferSentinel {
  const offerId =
    buyer.toHex() + "-" + index.toString() + "-" + sellOrder.toHex();
  let entity = OfferSentinel.load(offerId);
  if (!entity) {
    entity = new OfferSentinel(offerId);
    entity.offers = [];
  }
  return entity;
}

const STATE_MAP = ["Closed", "Open", "Committed"];

function updateOfferState(
  sellOrderAddress: Address | null,
  buyer: Address,
  index: BigInt,
  timestamp: BigInt,
  transaction_hash: string,
  event: string
): void {
  if (sellOrderAddress === null) {
    log.error("Seller address is null", []);
    return;
  }

  const offerSentinel = getOfferSentinel(buyer, index, sellOrderAddress);
  const offerEntity = getOffer(buyer, index, transaction_hash);
  log.info("updateOfferState: {} {} {} {} {} {}", [
    sellOrderAddress.toHex(),
    buyer.toHex(),
    index.toString(),
    timestamp.toString(),
    transaction_hash,
    offerSentinel.offers.length.toString(),
  ]);
  if (offerSentinel.offers.length > 0) {
    const oldOffer = Offer.load(
      offerSentinel.offers[offerSentinel.offers.length - 1]
    );
    if (!oldOffer) {
      log.error("Old offer not found. This should be impossible", []);
      return;
    }
    oldOffer.isCurrent = false;
    oldOffer.save();
  }
  offerSentinel.buyer = buyer;
  offerSentinel.index = index;
  offerSentinel.offers = offerSentinel.offers.concat([offerEntity.id]);
  offerSentinel.offer = offerEntity.id;

  let sellOrder = SellOrder.load(sellOrderAddress.toHex());
  if (!sellOrder) {
    log.error("Sell order not found. This should be impossible", []);
    return;
  }
  let sellOrderContract = SellOrderContract.bind(sellOrderAddress);

  let offerFromContract = sellOrderContract.offers(buyer, index);
  const state = offerFromContract.value0;
  const pricePerUnit = offerFromContract.value1;
  const stakePerUnit = offerFromContract.value2;
  const uri = offerFromContract.value3;
  const acceptedAt = offerFromContract.value4;
  const sellerCanceled = offerFromContract.value5;
  const buyerCanceled = offerFromContract.value6;
  const quantity = offerFromContract.value7;
  if (state >= STATE_MAP.length) {
    log.error("Invalid state: {}", [state.toString()]);
    return;
  }
  offerEntity.state = STATE_MAP[state];
  offerEntity.seller = sellOrder.seller;
  offerEntity.isCurrent = true;
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
  offerEntity.event = event;
  offerEntity.save();
  offerSentinel.save();
  sellOrder.offers = sellOrder.offers.concat([offerSentinel.id]);

  offerEntity.sellOrder = sellOrder.id;
  sellOrder.save();
  offerEntity.save();
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
