"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lambda/auth/pre-sign-up.ts
var pre_sign_up_exports = {};
__export(pre_sign_up_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(pre_sign_up_exports);
var ALLOWED_DOMAINS = ["vantagerefinery.com", "amplefi.com"];
async function handler(event) {
  const email = event.request.userAttributes.email;
  if (!email) {
    throw new Error("Email is required for account creation.");
  }
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
    throw new Error("Account creation is restricted to authorized email domains.");
  }
  if (event.triggerSource === "PreSignUp_AdminCreateUser") {
    event.response.autoVerifyEmail = true;
  }
  return event;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
