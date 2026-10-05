import dotenv from "dotenv";

dotenv.config();

// Central place for all environment-sourced config.
// Callers read from here; they never read process.env directly.

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),

  // When set, the merchant service will attempt to call a real provider.
  // When absent, the mock provider is used automatically.
  npciApiKey: process.env.NPCI_API_KEY ?? "",

  // When set, the fraud service will call the live ML prediction endpoint.
  // When absent, the mock fraud provider is used automatically.
  mlServiceUrl: process.env.ML_SERVICE_URL ?? "",
  mlServiceApiKey: process.env.ML_SERVICE_API_KEY ?? "",
} as const;
