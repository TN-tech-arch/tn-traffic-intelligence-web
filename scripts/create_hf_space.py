"""Create the public Docker Space for the current Hugging Face account."""

from __future__ import annotations

import argparse

from huggingface_hub import HfApi


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="tn-traffic-intelligence")
    parser.add_argument("--private", action="store_true")
    args = parser.parse_args()

    api = HfApi()
    account = api.whoami()
    username = account["name"]
    repo_id = f"{username}/{args.name}"
    url = api.create_repo(
        repo_id=repo_id,
        repo_type="space",
        space_sdk="docker",
        private=args.private,
        exist_ok=True,
    )
    print(repo_id)
    print(url)


if __name__ == "__main__":
    main()
