# Contributing to QR-Shield

## Branch workflow

- `main` is protected. Do not push directly.
- Create a branch for your work (see README for naming).
- Open a Pull Request and get a review before merging.

## Commit messages

Use the conventional commit format:

```
<type>: <short description>
```

Types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`

## Never commit

- `.env` files
- API keys, passwords, tokens
- Private keys
- Private datasets
- Trained model weights that contain sensitive data

## Tests

All PRs must pass CI (lint + type-check + tests) before merge.
