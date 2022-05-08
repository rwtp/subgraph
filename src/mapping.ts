import { ipfs, json, TypedMap, JSONValue, log} from "@graphprotocol/graph-ts"
import {
  OrderBook,
  FeeChanged,
  OwnerChanged,
  SellOrderCreated
} from "../generated/OrderBook/OrderBook"
import { SellOrder } from "../generated/schema"
import { SellOrder as SellOrderContract } from "../generated/OrderBook/SellOrder"


export function handleFeeChanged(event: FeeChanged): void {}

export function handleOwnerChanged(event: OwnerChanged): void {}

function getEntryString(typedMap: TypedMap<string, JSONValue>, key: string): string {
  const entry = typedMap.getEntry(key);
  if (entry) {
     return entry.value.toString();
  }
  return "Invalid String";
}

/// Mutates sellOrder by appending as much data as possible form the ipfs metadata.
/// ipfs metadata format must be:
/// {
///   "title": "title",
///   "description": "description",
///   "primaryImage": "ipfs://image/url",
///   "encryptionPublicKey": "encryptionPublicKey",
///   "priceSuggested": "0x000011",
///   "stakeSuggested": "0x024000",
/// }
function load_ipfs_meta_data(cid: string, sellOrder: SellOrder): void {
  let data = ipfs.cat(cid);
  if (!data) {
    sellOrder.error = `IPFS data not found for ${cid}`;
    log.error("Unable to get data at: {}", [cid]);
    return;
  }
  const tryValue = json.try_fromBytes(data);
  const typedMap = tryValue.value.toObject();
  if (!typedMap) {
    sellOrder.error = `invalid IPFS data for ${cid}`;
    log.error("Unable to parse data at: {}", [cid]);
    return;
  }
  sellOrder.title = getEntryString(typedMap, "title");
  sellOrder.description = getEntryString(typedMap, "description");
  sellOrder.primaryImage = getEntryString(typedMap, "primaryImage");
  sellOrder.encryptionPublicKey = getEntryString(typedMap, "encryptionPublicKey");
  sellOrder.priceSuggested = getEntryString(typedMap, "priceSuggested");
  sellOrder.stakeSuggested = getEntryString(typedMap, "stakeSuggested");
}

export function handleSellOrderCreated(event: SellOrderCreated): void {
  let entity = SellOrder.load(event.transaction.from.toHex())
  if (!entity) {
    entity = new SellOrder(event.transaction.from.toHex())
 
    // Entity fields can be set using simple assignments
  }
  // BigInt and BigDecimal math are supported
  entity.address = event.params.sellOrder;
  let sellOrderContract = SellOrderContract.bind(event.params.sellOrder);
  entity.uri = sellOrderContract.orderURI();
  entity.sellersStake = sellOrderContract.orderStake();

  if (entity.uri.startsWith("ipfs://")) {
    let cid = entity.uri.substring("ipfs://".length);
    load_ipfs_meta_data(cid, entity);
  }
  // Entities can be written to the store with `.save()`
  entity.save()
}
