"""
Trains the fraud detection model (Phase 3).
"""
import os
import joblib
import warnings

warnings.filterwarnings("ignore")

try:
    import pandas as pd
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.compose import ColumnTransformer
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    import xgboost as xgb
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

def train_and_eval(name, model, X_train, y_train, X_test, y_test):
    print(f"\n--- Training {name} ---")
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    
    acc = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, zero_division=0)
    rec = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)
    
    print(f"Accuracy:  {acc:.4f}")
    print(f"Precision: {prec:.4f}")
    print(f"Recall:    {rec:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print(f"Conf Matrix:\n{confusion_matrix(y_test, y_pred)}")
    
    return model, f1

def main():
    base_dir = os.getcwd()
    model_dir = os.path.join(base_dir, "models")
    data_path = os.path.join(base_dir, "data", "raw", "transactions.csv")
    
    if not SKLEARN_AVAILABLE:
        print("Scikit-Learn/Pandas not available. Writing a dummy model for the Node API to consume.")
        write_dummy_model(model_dir)
        return

    if not os.path.exists(data_path):
        print(f"Data not found at {data_path}. Run generate.py first.")
        return
        
    print(f"Loading data from {data_path}...")
    df = pd.read_csv(data_path)
    
    X = df.drop(columns=["is_fraud"])
    y = df["is_fraud"]
    
    X_train, X_test, y_train, y_test, df_train, df_test = train_test_split(
        X, y, df, test_size=0.2, random_state=42, stratify=y
    )
    
    print(f"Train samples: {len(X_train)} (Fraud: {sum(y_train)})")
    print(f"Test samples: {len(X_test)} (Fraud: {sum(y_test)})")
    
    numeric_features = [
        "vpa_length", "vpa_entropy", "payload_length", 
        "payload_entropy", "amount", "merchant_verified",
        "is_high_risk_provider", "has_suspicious_keyword"
    ]
    
    preprocessor = ColumnTransformer(
        transformers=[("num", StandardScaler(), numeric_features)]
    )
    
    models = {
        "Logistic Regression": Pipeline([
            ("preprocessor", preprocessor),
            ("classifier", LogisticRegression(class_weight="balanced", random_state=42))
        ]),
        "Random Forest": Pipeline([
            ("preprocessor", preprocessor),
            ("classifier", RandomForestClassifier(class_weight="balanced", n_estimators=100, max_depth=5, random_state=42))
        ]),
        "XGBoost": Pipeline([
            ("preprocessor", preprocessor),
            ("classifier", xgb.XGBClassifier(scale_pos_weight=len(y_train[y_train==0])/len(y_train[y_train==1]), eval_metric='logloss', random_state=42))
        ])
    }
    
    best_f1 = 0
    best_name = None
    best_model = None
    results = []
    
    for name, model in models.items():
        trained_model, f1 = train_and_eval(name, model, X_train, y_train, X_test, y_test)
        results.append(f"{name} -> F1: {f1:.4f}")
        if f1 > best_f1:
            best_f1 = f1
            best_name = name
            best_model = trained_model
            
    print(f"\n==================================================")
    print(f"⭐ BEST MODEL: {best_name} (F1: {best_f1:.4f})")
    print(f"==================================================")
    
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, "model.joblib")
    joblib.dump(best_model, model_path)
    print(f"Model exported to: {model_path}")

    with open(os.path.join(model_dir, "metrics.txt"), "w") as f:
        f.write(f"Best Model: {best_name}\n")
        f.write(f"F1 Score: {best_f1:.4f}\n\n")
        f.write("All results:\n" + "\n".join(results))

# --- Dummy model for environments without sklearn ---
class DummyEstimator:
    def predict_proba(self, X):
        return [[0.8, 0.2]] * len(X)
        
class DummyModel:
    def __init__(self):
        self.steps = [('classifier', DummyEstimator())]
        self._is_dummy = True
        
    def predict_proba(self, X):
        out = []
        for row in X:
            if row.get('is_high_risk_provider', 0) == 1 or row.get('merchant_verified', 1) == 0:
                out.append([0.15, 0.85])
            elif row.get('has_suspicious_keyword', 0) == 1:
                out.append([0.45, 0.55])
            else:
                out.append([0.90, 0.10])
        return out

def write_dummy_model(model_dir):
    os.makedirs(model_dir, exist_ok=True)
    joblib.dump(DummyModel(), os.path.join(model_dir, "model.joblib"))
    print("Wrote dummy model to models/model.joblib")

if __name__ == "__main__":
    main()