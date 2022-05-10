import { ipfs, json, TypedMap, JSONValue, log} from "@graphprotocol/graph-ts"
import {
  OfferSubmitted
} from "../generated/templates/SellOrder/SellOrder"
import { Offer, SellOrder } from "../generated/schema"
import { SellOrder as SellOrderContract } from "../generated/OrderBook/SellOrder"
import { ERC20 } from "../generated/OrderBook/ERC20"




export function handleOfferSubmitted(event: OfferSubmitted): void {
  const eventAddress = event.params.buyer.toHex();
  
  log.info("OfferSubmitted: {}", [eventAddress]);
  let entity = Offer.load(eventAddress);
  if (!entity) {
      entity = new Offer(eventAddress);
  }
  entity.sellerAddress = event.transaction.to;
  entity.buyerAddress = event.params.buyer;
  entity.index = event.params.index;
  entity.pricePerUnit = event.params.pricePerUnit;
  entity.quantity = event.params.quantity;
  entity.stakePerUnit = event.params.stakePerUnit;
  entity.uri = event.params.uri;
  entity.save();
  const sellerAddress = event.transaction.to;
  if (sellerAddress === null) {
    log.warning("Seller address is null", []);
    return;
  }
  let sellOrder = SellOrder.load(sellerAddress.toHex());
  if (!sellOrder) {
    log.warning("SellOrder not found", []);
    return;
  }
  sellOrder.offers = sellOrder.offers.concat([entity.id]);
  sellOrder.save();


  
}
