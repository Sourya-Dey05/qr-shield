"""
ML Service API. Wraps the trained model in a FastAPI container.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import os
import uvicorn
from typing import Dict

app = FastAPI()

# Load model
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "model.joblib")
if not os.path.exists(MODEL_PATH):
    raise RuntimeError("Model file not found at " + MODEL_PATH)

model = joblib.load(MODEL_PATH)

class FraudFeatures(BaseModel):
    normalizedUpiId: str
    payload: str
    merchantVerified: bool

@app.post("/predict")
async def predict(request: Dict[str, FraudFeatures]):
    features = request.get("features")
    if not features:
        raise HTTPException(status_code=400, detail="Missing 'features' in body")
    
    # 1. Feature Engineering (Must match train.py)
    import math
    def entropy(string):
        if not string: return 0.0
        prob = [ float(string.count(c)) / len(string) for c in dict.fromkeys(list(string)) ]
        return - sum([ p * math.log(p) / math.log(2.0) for p in prob ])

    # Derived from features
    vpa = features.normalizedUpiId
    vpa_provider = vpa.split('@')[1] if '@' in vpa else ""
    
    # Matching the training features
    input_data = [{
        "vpa_length": len(vpa),
        "vpa_entropy": round(entropy(vpa), 3),
        "payload_length": len(features.payload),
        "payload_entropy": round(entropy(features.payload), 3),
        "amount": 1000.0, # Placeholder, real amount should be derived from payload
        "merchant_verified": int(features.merchantVerified),
        "is_high_risk_provider": int(vpa_provider in ["upi", "ybl", "paytm", "okicici"]),
        "has_suspicious_keyword": int(any(kw in features.payload.lower() for kw in ["urgent", "refund", "kyc", "block", "verify", "offer", "discount", "claim", "win"])),
    }]

    # 2. Prediction
    # Sklearn returns [prob_normal, prob_fraud]
    probs = model.predict_proba(input_data)[0]
    fraud_prob = float(probs[1])
    
    # 3. Decision Logic
    risk_score = int(fraud_prob * 100)
    risk_level = "low"
    if risk_score >= 70: risk_level = "high"
    elif risk_score >= 30: risk_level = "medium"
    
    return {
        "fraudProbability": fraud_prob,
        "riskScore": risk_score,
        "riskLevel": risk_level,
        "modelVersion": "v1-dummy" if getattr(model, "_is_dummy", False) else "v1-trained"
    }

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4020)