# QR-Shield ML Design Document

## Dataset: PaySim-Calibrated Synthetic UPI Fraud

### Motivation
NPCI transaction data is proprietary; no public UPI QR fraud dataset exists.
Following standard academic practice (Lopez-Rojas et al.), we generated synthetic
UPI-specific training data calibrated on the published fraud statistics of **PaySim**,
the standard synthetic financial fraud benchmark.

### PaySim Statistics Replicated
| Metric | Value |
|--------|-------|
| Total Transactions | 6,362,620 |
| Fraud Count | 8,213 |
| **Fraud Rate** | **0.129%** |
| Fraud Types | TRANSFER, CASH_OUT only |
| Amount Distribution | Power-law skewed right |

### Our Generated Dataset
| Metric | Value |
|--------|-------|
| Total Rows | 15,000 |
| Fraud Rate | 0.130% (exact calibration) |
| Features | 8 numeric features (vpa_length, vpa_entropy, payload_length, payload_entropy, amount, merchant_verified, is_high_risk_provider, has_suspicious_keyword) |
| Target | is_fraud (0/1) |

### Training Pipeline
- Split: 80/20 stratified
- Preprocessing: StandardScaler on all numeric features
- Class Imbalance Handling: `class_weight="balanced"` for LR/RF, `scale_pos_weight` for XGBoost
- Evaluation Metric: **F1-Score** (Accuracy is misleading on 0.13% positive class)

## Model Comparison Results (Phase 3)

| Model | Accuracy | Precision | Recall | **F1-Score** |
|-------|----------|-----------|--------|--------------|
| Logistic Regression | 94.87% | 2.53% | **100.00%** | 4.94% |
| Random Forest | 99.80% | 37.50% | 75.00% | 50.00% |
| **XGBoost** | **99.93%** | **75.00%** | 75.00% | **75.00%** |

### Selected Model: **XGBoost (v1)**
- **Best F1-Score: 0.7500**
- Strong balance between Precision and Recall
- Highest overall accuracy on test set
- Low false positive rate (1 false alarm per 3000 normal transactions)

### Confusion Matrix (XGBoost on 3,000 test samples)
```
                 Predicted
                 Normal  Fraud
Actual Normal    2995     1
Actual Fraud      1       3
```

### Why F1-Score over Accuracy?
With 0.13% fraud rate, a model predicting "Never Fraud" achieves 99.87% accuracy but 0% recall.
**F1-Score** is the harmonic mean of Precision and Recall, making it the industry standard for
highly imbalanced fraud detection. Our XGBoost model catches **75% of fraud attempts** while keeping
false alarms extremely low.

## Architecture Integration
- **Backend** calls `POST /predict` with `{ features: FraudInput }`
- **ML Service** (FastAPI) loads `model.joblib`, engineers features inline, returns:
  ```json
  {
    "fraudProbability": 0.85,
    "riskScore": 85,
    "riskLevel": "high",
    "modelVersion": "v1"
  }
  ```
- **Decision Engine** maps: `riskLevel="high"` → 🔴 RED badge

## Reproducibility
- Random seed: `42` (fixed across NumPy, Python, Sklearn)
- Generator: `ml/data/generate.py`
- Trainer: `ml/train.py`
- Both accept no external data dependencies; fully reproducible CI artifacts.