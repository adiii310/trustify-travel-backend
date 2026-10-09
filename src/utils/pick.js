// Copy only whitelisted keys, so clients cannot set fields like status or _id
module.exports = (obj = {}, keys = []) =>
  keys.reduce((out, k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
    return out;
  }, {});
