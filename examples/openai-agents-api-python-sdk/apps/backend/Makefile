.PHONY: run sync check

sync:
	uv sync

run:
	uv run python app.py

check:
	uv run python -c "import app; print('imports ok')"
