// Serializes a value for embedding inside a <script type="application/json">
// tag. Plain JSON.stringify() output can contain a literal "</script"
// sequence (e.g. a saved name tag/schedule card template with that text in
// a custom label), which would terminate the tag early and break the page -
// or, if attacker-controlled text made it in, run arbitrary script. Escaping
// "<" as its JSON unicode escape prevents that while still parsing back to
// the exact same value on the client.
// Security audit: also safe inside a single-quoted HTML attribute
// (data-x='...'). None of these characters can appear in JSON outside a
// string, and inside a string the \uXXXX form parses back identically.
function jsonScriptSafe(value) {
  const json = JSON.stringify(value);
  if (json === undefined) return 'null';
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = { jsonScriptSafe };
