# QR-Shield ML Service (Phase 3)

Fraud risk scoring via a trained XGBoost model, exposed over HTTP.

## Structure

```
ml/
├── api/server.py          ← FastAPI app, POST /predict
├── data/generate.py       ← PaySim-calibrated synthetic UPI dataset generator
├── train.py               ← Trains LogReg / RandomForest / XGBoost, exports best
├── requirements.txt
└── models/
    ├── model.joblib       ← NOT committed (generated artifact, see .gitignore)
    └── metrics.txt        ← Evaluation results (committed)
```

## Running locally (or in Colab)

```bash
pip install -r requirements.txt

# 1. Generate training data (seeded, reproducible)
python data/generate.py

# 2. Train and evaluate (writes models/model.joblib + models/metrics.txt)
python train.py

# 3. Serve predictions
uvicorn api.server:app --host 127.0.0.1 --port 4020
```

Point the Node backend at it:

```bash
# api/.env
ML_SERVICE_URL=http://127.0.0.1:4020
ML_SERVICE_API_KEY=dev-ml-key
```

## Model results (v1)

See [`docs/ml-design.md`](../docs/ml-design.md) and [`models/metrics.txt`](models/metrics.txt).

**Best: XGBoost — F1 0.7500**, Precision 75%, Recall 75% on a 3k test split with
0.13% fraud rate. Logistic Regression recalled everything but precision-collapsed
(F1 0.0494), which is exactly why F1 — not accuracy — is the metric of record.

## Limitations

Training data is synthetic, calibrated on PaySim's published statistics because
NPCI transaction data is proprietary. See `docs/ml-design.md` for the full
justification and the production-data caveat.