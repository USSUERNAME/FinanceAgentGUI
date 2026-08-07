"""Validate the broker-research source and rights registry without network access."""

from broker_research_policy import load_registry


def main() -> None:
    registry = load_registry()
    print(f"Broker research source registry OK: {len(registry['sources'])} source(s)")


if __name__ == "__main__":
    main()
