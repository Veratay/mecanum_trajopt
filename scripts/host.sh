#!/bin/bash

usage() {
    echo "Usage: $0 [--project-dir <path>]"
    echo "  --project-dir  Directory for storing projects and images (default: ./projects)"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --project-dir)
            if [[ -z "$2" || "$2" == --* ]]; then
                echo "Error: --project-dir requires a path argument"
                usage
            fi
            export TRAJOPT_PROJECT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

source .venv/bin/activate
python -m uvicorn backend.server:app --reload --port 8080
