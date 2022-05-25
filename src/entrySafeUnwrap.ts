import { TypedMap, JSONValue, JSONValueKind, Bytes, log } from "@graphprotocol/graph-ts";

export function getEntryString(
  typedMap: TypedMap<string, JSONValue>,
  key: string
): string {
  const entry = typedMap.getEntry(key);
  if (entry && entry.value.kind == JSONValueKind.STRING) {
    return entry.value.toString();
  }
  log.warning("Unable to parse string at: {}", [key]);
  return "";
}

export function getEntryArrayStrings(
  typedMap: TypedMap<string, JSONValue>,
  key: string
): Array<string> {
  const entry = typedMap.getEntry(key);
  if (entry && entry.value.kind == JSONValueKind.ARRAY) {
    let array = entry.value.toArray();
    return array.map<string>((e) => e.toString());
  }
  log.warning("Unable to parse string at: {}", [key]);
  return [""];
}
