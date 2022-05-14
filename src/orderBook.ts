import { ipfs, json, TypedMap, JSONValue, log, BigInt, Address} from "@graphprotocol/graph-ts"
import {
  FeeChanged,
  OwnerChanged,
  SellOrderCreated,
  OrderBook as OrderBookContract,
} from "../generated/OrderBook/OrderBook"
import { SellOrder, Token, OrderBook } from "../generated/schema"
import { SellOrder as SellOrderContract } from "../generated/templates/SellOrder/SellOrder"
import { ERC20 } from "../generated/OrderBook/ERC20"

import * as templates from "../generated/templates"
import { getEntryString } from "./entrySafeUnwrap"

export function handleFeeChanged(event: FeeChanged): void {}

export function handleOwnerChanged(event: OwnerChanged): void {}


/// Mutates sellOrder by appending as much data as possible from the ipfs metadata.
/// ipfs metadata format must be:
/// {
///   "title": "title",
///   "description": "description",
///   "primaryImage": "ipfs://image/url",
///   "encryptionPublicKey": "encryptionPublicKey",
///   "priceSuggested": "0x000011",
///   "stakeSuggested": "0x024000",
/// }
function load_ipfs_meta_data(uri: string, sellOrder: SellOrder): SellOrder {
  const cid = uri.replace("ipfs://", "");
  let data = ipfs.cat(cid);
  if (!data) {
    sellOrder.error = `IPFS data not found for ${cid}`;
    log.warning("Unable to get data at: {}", [cid]);
    return sellOrder;
  } 
  const tryValue = json.try_fromBytes(data);
  const typedMap = tryValue.value.toObject();
  if (!typedMap) {
    sellOrder.error = `invalid IPFS data for ${cid}`;
    log.warning("Unable to parse data at: {}", [cid]);
    return sellOrder;
  }
  sellOrder.title = getEntryString(typedMap, "title");
  sellOrder.description = getEntryString(typedMap, "description");
  sellOrder.primaryImage = getEntryString(typedMap, "primaryImage");
  sellOrder.encryptionPublicKey = getEntryString(typedMap, "encryptionPublicKey");
  sellOrder.priceSuggested = getEntryString(typedMap, "priceSuggested");
  sellOrder.stakeSuggested = getEntryString(typedMap, "stakeSuggested");
  return sellOrder;
}

function load_erc20_data(tokenAddress: Address, sellOrder: SellOrder): SellOrder {
  sellOrder.tokenAddress = tokenAddress;
  let tokenEntity = Token.load(tokenAddress.toHex());
  if (!tokenEntity) {
    tokenEntity = new Token(tokenAddress.toHex());
  }
  tokenEntity.address = tokenAddress;
  let tokenContract = ERC20.bind(tokenAddress);
  if (!tokenContract) {
    sellOrder.error = `ERC20 contract not found for ${tokenAddress}`;
    log.warning("Unable to get ERC20 contract at: {}", [tokenAddress.toHex()]);
    return sellOrder;
  } else {
    tokenEntity.name = tokenContract.name();
    tokenEntity.symbol = tokenContract.symbol();
    tokenEntity.decimals = BigInt.fromI32(tokenContract.decimals());
    tokenEntity.totalSupply = tokenContract.totalSupply();
    tokenEntity.save();
    sellOrder.token = tokenEntity.id;
  }
  return sellOrder;
}

function create_sell_order(sellOrderAddress: Address, timestamp: BigInt): SellOrder {
  let sellOrderEntity = SellOrder.load(sellOrderAddress.toHex());
  if (!sellOrderEntity) {
    sellOrderEntity = new SellOrder(sellOrderAddress.toHex());
  } else {
    log.error("Sell order already exists: {}", [sellOrderAddress.toHex()]);
    log.error("This should not be possible, overwriting existing sellOrder", []);
  }
  let sellOrderContract = SellOrderContract.bind(sellOrderAddress);

  sellOrderEntity.createdAt = timestamp;
  sellOrderEntity.address = sellOrderAddress;
  sellOrderEntity.buyers = [];
  sellOrderEntity = load_erc20_data(sellOrderContract.token(), sellOrderEntity);
  sellOrderEntity.seller = sellOrderContract.seller();
  sellOrderEntity.timeout = sellOrderContract.timeout();
  sellOrderEntity.uri = sellOrderContract.orderURI();
  sellOrderEntity.sellersStake = sellOrderContract.orderStake();
  sellOrderEntity = load_ipfs_meta_data(sellOrderEntity.uri, sellOrderEntity);
  sellOrderEntity.save();
  return sellOrderEntity;
}



export function handleSellOrderCreated(event: SellOrderCreated): void {
  let sellOrderAddress = event.params.sellOrder;
  templates.SellOrder.create(sellOrderAddress);
  let sellOrderEntity = create_sell_order(sellOrderAddress, event.block.timestamp);
  let orderBookAddress = event.address;
  let orderBookEntity = OrderBook.load(orderBookAddress.toHex());
  if (!orderBookEntity) {
    orderBookEntity = new OrderBook(orderBookAddress.toHex());
    orderBookEntity.orders = [];
  }
  
  let orderBookContract = OrderBookContract.bind(orderBookAddress);
  orderBookEntity.fee = orderBookContract.fee();
  orderBookEntity.owner = orderBookContract.owner();

  orderBookEntity.orders = orderBookEntity.orders.concat([sellOrderEntity.id]);
  orderBookEntity.save();
}
