import { TypedMap, JSONValue } from "@graphprotocol/graph-ts";

export function getEntryString(
  typedMap: TypedMap<string, JSONValue>,
  key: string
): string {
  const entry = typedMap.getEntry(key);
  if (entry) {
    return entry.value.toString();
  }
  return "Invalid String";
}
