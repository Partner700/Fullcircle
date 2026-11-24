#!/usr/bin/env python3
"""Package an extracted volume for instructor review via import_arena_journey_questions.

This command writes a local JSON payload only. It never connects to Supabase or
approves a question. A character needs seven configured narrative beat labels.
"""

import argparse
import json
import re
from pathlib import Path


def slugify(value):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def make_payload(volume, beats, skip_flagged=False):
    character = volume["character"]
    slug = slugify(character)
    labels = beats.get(slug)
    if not isinstance(labels, list) or len(labels) != 7 or not all(isinstance(label, str) and 2 <= len(label.strip()) <= 120 for label in labels):
        raise ValueError(f"{character} needs seven configured narrative beat labels")
    questions = volume["questions"]
    if any(item["extraction_issues"] for item in questions) and not skip_flagged:
        raise ValueError(f"{character} still has flagged extraction issues; repair or reject them first")
    if skip_flagged:
        questions = [item for item in questions if not item["extraction_issues"]]
    if not questions:
        raise ValueError(f"{character} has no unflagged questions to stage")
    if len({item["source_number"] for item in questions}) != len(questions):
        raise ValueError(f"{character} has repeated source numbers")
    converted = []
    for item in questions:
        options = [option["text"] for option in item["options"]]
        answer = item["correct_answer"]
        if item["type"] in ("multiple_choice", "odd_one") and item["correct_answer"] not in options:
            raise ValueError(f"Question #{item['source_number']} has no matching answer option")
        if item["type"] == "order_sequence":
            source_labels = [option["label"] for option in item["options"]]
            order = answer.split()
            if len(order) != len(source_labels) or set(order) != set(source_labels):
                raise ValueError(f"Question #{item['source_number']} has an invalid ordering answer")
            canonical = {label: chr(ord("A") + index) for index, label in enumerate(source_labels)}
            answer = " ".join(canonical[label] for label in order)
        if not item.get("reference"):
            raise ValueError(f"Question #{item['source_number']} has no Scripture reference")
        converted.append({
            "source_number": item["source_number"],
            "source_kind": item["source_kind"],
            "source_question_page": item["source_question_page"],
            "source_answer_page": item["source_answer_page"],
            "stage": item["stage"],
            "type": item["type"],
            "question": item["question"],
            "options": options,
            "correct_answer": answer,
            "answer_key_text": item["answer_key_text"],
            "reference": item["reference"],
            "difficulty_tag": "easy" if item["stage"] <= 2 else "hard" if item["stage"] >= 4 else "moderate",
        })
    return {
        "p_character_slug": slug,
        "p_character_name": character,
        "p_narrative_beats": labels,
        "p_questions": converted,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("volume", type=Path, help="Extracted volume-NN.json")
    parser.add_argument("output", type=Path, help="Local JSON output; not a database command")
    parser.add_argument("--beats", type=Path, default=Path(__file__).with_name("biblical-journey-beats.json"))
    parser.add_argument("--skip-flagged", action="store_true", help="Leave flagged entries local for manual repair")
    args = parser.parse_args()
    payload = make_payload(json.loads(args.volume.read_text()), json.loads(args.beats.read_text()), args.skip_flagged)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"Prepared {len(payload['p_questions'])} pending-review questions for {payload['p_character_name']}; nothing was uploaded.")


if __name__ == "__main__":
    main()
