"""
Generate PaySim-calibrated synthetic UPI dataset.
"""
import os
import numpy as np
import pandas as pd
import random
import math

# Reproducibility
RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)
random.seed(RANDOM_SEED)

N_ROWS = 15000 
FRAUD_RATE = 0.0013 

HIGH_RISK_HANDLES = ["@upi", "@ybl", "@paytm", "@okicici"] 
LOW_RISK_HANDLES = ["@hdfc", "@sbi", "@okaxis", "@icici"]
FRAUD_KEYWORDS = ["urgent", "refund", "kyc", "block", "verify", "offer", "discount", "claim", "win"]
NORMAL_KEYWORDS = ["buy", "store", "shop", "pay", "order", "bill", "grocery", "coffee"]

def entropy(string):
    if not string: return 0.0
    prob = [ float(string.count(c)) / len(string) for c in dict.fromkeys(list(string)) ]
    return - sum([ p * math.log(p) / math.log(2.0) for p in prob ])

def generate_amount(is_fraud):
    if is_fraud:
        if random.random() < 0.2:
            return round(random.uniform(10, 100), 2)
        else:
            return round(random.uniform(40000, 100000), 2)
    else:
        amount = np.random.lognormal(mean=5.5, sigma=1.5)
        amount = min(amount, 100000)
        return round(max(1.0, amount), 2)

def generate_vpa(is_fraud):
    base_len = random.randint(5, 15)
    chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    local = "".join(random.choice(chars) for _ in range(base_len))
    
    if is_fraud:
        if random.random() < 0.6:
            spoof = random.choice(["flipkart", "amazon", "zomato", "swiggy", "hdfsc", "sbi-support"])
            local = f"{spoof}{random.randint(10, 99)}"
        handle = random.choice(HIGH_RISK_HANDLES) if random.random() < 0.8 else random.choice(LOW_RISK_HANDLES)
    else:
        if random.random() < 0.3:
            local = f"user.{random.randint(1000, 9999)}"
        handle = random.choice(LOW_RISK_HANDLES + HIGH_RISK_HANDLES)
        
    return f"{local}{handle}"

def generate_payload_features(is_fraud, vpa, amount):
    pn = "xyz"
    if is_fraud:
        keyword = random.choice(FRAUD_KEYWORDS) if random.random() < 0.7 else random.choice(NORMAL_KEYWORDS)
        pn = f"{keyword}{random.randint(1,99)}"
    else:
        keyword = random.choice(NORMAL_KEYWORDS) if random.random() < 0.4 else "merchant"
        pn = f"{keyword}{random.randint(1,99)}"
        
    tr = "".join(random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(random.randint(5, 20))) if random.random() > 0.5 else ""
    payload = f"upi://pay?pa={vpa}&pn={pn}&am={amount}"
    if tr:
        payload += f"&tr={tr}"
    return payload

def main():
    print(f"Generating PaySim-calibrated synthetic UPI dataset...")
    
    data = []
    n_fraud = int(N_ROWS * FRAUD_RATE)
    n_normal = N_ROWS - n_fraud
    labels = [1] * n_fraud + [0] * n_normal
    random.shuffle(labels)
    
    for label in labels:
        is_fraud = bool(label)
        vpa = generate_vpa(is_fraud)
        amount = generate_amount(is_fraud)
        payload = generate_payload_features(is_fraud, vpa, amount)
        
        merchant_verified = True if random.random() < (0.05 if is_fraud else 0.85) else False
            
        data.append({
            "vpa_length": len(vpa),
            "vpa_entropy": round(entropy(vpa), 3),
            "payload_length": len(payload),
            "payload_entropy": round(entropy(payload), 3),
            "amount": amount,
            "merchant_verified": int(merchant_verified),
            "is_high_risk_provider": int((vpa.split('@')[1] if '@' in vpa else "") in ["upi", "ybl", "paytm", "okicici"]),
            "has_suspicious_keyword": int(any(kw in payload.lower() for kw in FRAUD_KEYWORDS)),
            "is_fraud": label
        })
        
    df = pd.DataFrame(data)
    
    output_dir = os.path.join(os.getcwd(), "data", "raw")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "transactions.csv")
    
    df.to_csv(output_path, index=False)
    print(f"Saved to: {output_path}")

if __name__ == "__main__":
    main()