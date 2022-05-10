import { ipfs, json, TypedMap, JSONValue, log} from "@graphprotocol/graph-ts"
import {
  OfferSubmitted
} from "../generated/OrderBook/SellOrder"
import { Offer } from "../generated/schema"
import { SellOrder as SellOrderContract } from "../generated/OrderBook/SellOrder"



export function handleOfferSubmitted(event: OfferSubmitted): void {
  const eventAddress = event.params.buyer.toHex();
  log.info("OfferSubmitted: {}", [eventAddress]);
  let entity = Offer.load(eventAddress);
  if (!entity) {
      entity = new Offer(eventAddress);
  }
  entity.save();
}
