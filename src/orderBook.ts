import {
  ipfs,
  json,
  log,
  BigInt,
  Address,
  Bytes,
} from "@graphprotocol/graph-ts";
import {
  FeeChanged,
  OwnerChanged,
  OrderCreated,
  OrderBook as OrderBookContract,
} from "../generated/OrderBook/OrderBook";
import { Order, OrderBook, Token } from "../generated/schema";
import { Order as OrderContract } from "../generated/templates/Order/Order";

import * as templates from "../generated/templates";
import { getEntryArrayBytes, getEntryString } from "./entrySafeUnwrap";
import { ERC20 } from "../generated/OrderBook/ERC20";

export function handleFeeChanged(event: FeeChanged): void {}

export function handleOwnerChanged(event: OwnerChanged): void {}

/// Mutates order by appending as much data as possible from the ipfs metadata.
/// ipfs metadata format must be:
/// {
///   "title": "title",
///   "description": "description",
///   "primaryImage": "ipfs://image/url",
///   "encryptionPublicKey": "encryptionPublicKey",
///   "tokenAddressesSuggested": ["tokenAddress"],
///   "priceSuggested": "0x000011",
///   "sellersStakeSuggested": "0x024000",
///   "buyersCostSuggested": "0x024000",
///   "suggestedTimeout": "0x024000",
/// }
function load_ipfs_meta_data(uri: string, order: Order): Order {
  const cid = uri.replace("ipfs://", "");
  let data = ipfs.cat(cid);
  if (!data) {
    order.error = `IPFS data not found for ${cid}`;
    log.warning("Unable to get data at: {}", [cid]);
    return order;
  }
  const tryValue = json.try_fromBytes(data);
  const typedMap = tryValue.value.toObject();
  if (!typedMap) {
    order.error = `invalid IPFS data for ${cid}`;
    log.warning("Unable to parse data at: {}", [cid]);
    return order;
  }
  order.title = getEntryString(typedMap, "title");
  order.description = getEntryString(typedMap, "description");
  order.primaryImage = getEntryString(typedMap, "primaryImage");
  order.encryptionPublicKey = getEntryString(
    typedMap,
    "encryptionPublicKey"
  );
  order.tokenAddressesSuggested =  getEntryArrayBytes(typedMap, "tokenAddressesSuggested");
  if (order.tokenAddressesSuggested) {
    order.tokensSuggested =  getEntryArrayTokens(order.tokenAddressesSuggested!);
  }
  order.priceSuggested =  getEntryString(typedMap, "priceSuggested");
  order.sellersStakeSuggested =  getEntryString(typedMap, "sellersStakeSuggested");
  order.buyersCostSuggested =  getEntryString(typedMap, "buyersCostSuggested");
  order.suggestedTimeout =  getEntryString(typedMap, "suggestedTimeout");
  let offerSchemaCid = getEntryString(typedMap, "offerSchema");
  if (offerSchemaCid) {
    let offerSchemaData = ipfs.cat(offerSchemaCid.replace("ipfs://", ""));
    if (!offerSchemaData) {
      order.error = `IPFS data not found for ${offerSchemaCid}`;
      log.warning("Unable to get data at: {}", [offerSchemaCid]);
    } else {
      order.offerSchema = offerSchemaData.toString();
      order.offerSchemaUri = offerSchemaCid;
    }
  }
  return order;
}

function create_sell_order(
  orderAddress: Address,
  timestamp: BigInt
): Order {
  let orderEntity = Order.load(orderAddress.toHex());
  if (!orderEntity) {
    orderEntity = new Order(orderAddress.toHex());
  } else {
    log.error("Sell order already exists: {}", [orderAddress.toHex()]);
    log.error(
      "This should not be possible, overwriting existing order",
      []
    );
  }
  let orderContract = OrderContract.bind(orderAddress);

  orderEntity.createdAt = timestamp;
  orderEntity.address = orderAddress;
  orderEntity.offers = [];
  orderEntity.offerCount = BigInt.fromI32(0);
  orderEntity.maker = orderContract.maker();
  orderEntity.uri = orderContract.orderURI();
  orderEntity = load_ipfs_meta_data(orderEntity.uri, orderEntity);
  orderEntity.save();
  return orderEntity;
}

export function handleOrderCreated(event: OrderCreated): void {
  let orderAddress = event.params.order;
  templates.Order.create(orderAddress);
  let orderEntity = create_sell_order(
    orderAddress,
    event.block.timestamp
  );
  let orderBookAddress = event.address;
  let orderBookEntity = OrderBook.load(orderBookAddress.toHex());
  if (!orderBookEntity) {
    orderBookEntity = new OrderBook(orderBookAddress.toHex());
    orderBookEntity.orders = [];
  }

  let orderBookContract = OrderBookContract.bind(orderBookAddress);
  orderBookEntity.fee = orderBookContract.fee();
  orderBookEntity.owner = orderBookContract.owner();

  orderBookEntity.orders = orderBookEntity.orders.concat([orderEntity.id]);
  orderBookEntity.save();
}

function getEntryArrayTokens(
  tokenAddresses: Bytes[]
): string[] {
  let tokenEntityIds: string[] = [];
  for (let i = 0; i < tokenAddresses.length; i++) { 
    const tokenAddress = tokenAddresses[i];
    let tokenEntity = Token.load(tokenAddress.toHex());
    if (!tokenEntity) {
      tokenEntity = new Token(tokenAddress.toHex());
    }
    tokenEntity.address = tokenAddress;
    let tokenContract = ERC20.bind(Address.fromBytes(tokenAddress));
    if (!tokenContract) {
      log.warning("Unable to get ERC20 contract at: {}", [tokenAddress.toHex()]);
      break;
    } else {
      tokenEntity.name = tokenContract.name();
      tokenEntity.symbol = tokenContract.symbol();
      tokenEntity.decimals = BigInt.fromI32(tokenContract.decimals());
      tokenEntity.totalSupply = tokenContract.totalSupply();
      tokenEntity.save();
      tokenEntityIds.push(tokenEntity.id);
    }
  }
  return tokenEntityIds;
}
