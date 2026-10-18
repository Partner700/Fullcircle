#!/usr/bin/env python3
"""Extract the supplied 20-volume study PDF into reviewable Journey question JSON.

Requires PyMuPDF (fitz). This is an extraction tool, not a fact checker or publisher.
All exported questions remain pending editorial review.
"""

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import fitz


VOLUME_NAMES = (
    "Jesus Christ", "Moses", "David", "Paul", "Abraham", "Jacob", "Joseph",
    "Peter", "Solomon", "King Saul", "Daniel & Nebuchadnezzar", "Elijah",
    "Elisha", "Samson", "Gideon", "Esther", "Ruth", "Joshua", "Noah",
    "Adam & Eve",
)
ITEM = re.compile(r"^\s*0*(\d{1,3})\s*[.)·]\s+(.+)$")
STAGE = re.compile(r"^\s*(?:stage\s+)?0?([1-5])\s*[:—–-]\s+", re.I)
VOLUME = re.compile(r"\bvolume\s+0*(\d{1,2})\b", re.I)
OPTION = re.compile(r"(?:^|\s)([A-E])[.)]\s+")
NUMBERED_OPTION = re.compile(r"(?:^|[\s|;])([1-5])[.)]\s+")
PAGE_HEADER = re.compile(r"^(?:the )?biblical journey\b|^volume\s+\d+\b", re.I)
BARE_STAGES = {
    "normal beginning": 1,
    "moment of calling": 2,
    "training and preparation": 3,
    "the great fight": 4,
    "outcome and legacy": 5,
}
BIBLE_BOOK = re.compile(
    r"^(?:(?:[1-3]|1[–-]2)\s+)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalm|Psalms|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+\d|^Song of Songs\s+\d",
    re.I,
)


def tidy(value):
    return re.sub(r"\s+", " ", value).strip()


def answer_marker_index(lines):
    return next((index for index, line in enumerate(lines) if re.match(r"^\s*Answer Key(?:\s*(?:&|and|$))", line, re.I)), None)


def split_volumes(document):
    starts = []
    previous = None
    for page_index, page in enumerate(document):
        match = VOLUME.search(page.get_text()[:220])
        if match:
            number = int(match.group(1))
            if number != previous:
                starts.append((number, page_index))
                previous = number
    if [number for number, _ in starts] != list(range(1, 21)):
        raise ValueError("Expected volume boundaries 1 through 20 in order")
    return [
        (number, start, starts[index + 1][1] if index < 19 else len(document))
        for index, (number, start) in enumerate(starts)
    ]


def extract_items(document, start, end, answer_start, answer_section):
    items = {}
    stages = {}
    stage = None
    current = None
    for page_index in range(start, end):
        lines = document[page_index].get_text().splitlines()
        if (page_index < answer_start and answer_section) or (page_index > answer_start and not answer_section):
            continue
        if page_index == answer_start:
            marker = answer_marker_index(lines)
            lines = lines[marker + 1:] if answer_section else lines[:marker]
        for line in lines:
            stage_match = STAGE.match(line)
            if stage_match:
                stage = int(stage_match.group(1))
                current = None
                continue
            bare_stage = BARE_STAGES.get(line.strip().lower())
            if bare_stage:
                stage = bare_stage
                current = None
                continue
            match = ITEM.match(line)
            if match and 1 <= int(match.group(1)) <= 200 and int(match.group(1)) >= len(items) + 1:
                number = int(match.group(1))
                if number in items:
                    raise ValueError(f"Duplicate item {number} on PDF page {page_index + 1}")
                items[number] = {"text": match.group(2).strip(), "pdf_page": page_index + 1}
                if stage is not None:
                    stages[number] = stage
                current = number
            elif current is not None and line.strip() and not PAGE_HEADER.match(line) and not re.match(r"^\s*\d{1,2}\s*$", line):
                items[current]["text"] += " " + line.strip()
    for record in items.values():
        record["text"] = tidy(record["text"])
    return items, stages


def question_type(prompt):
    lower = prompt.lower()
    bracket = re.match(r"^\[([^]]+)\]", lower)
    if bracket:
        label = bracket.group(1)
        if "true" in label:
            return "true_false"
        if "multiple" in label:
            return "multiple_choice"
        if "odd" in label:
            return "odd_one"
        if "fill" in label:
            return "fill_blank"
        if "arrange" in label:
            return "order_sequence"
    if re.match(r"^(?:arrange|chronological)", lower):
        return "order_sequence"
    if re.match(r"^fill", lower):
        return "fill_blank"
    if re.match(r"^select the odd", lower):
        return "odd_one"
    if "[true or false]" in lower or "true or false" in lower or "(true or false)" in lower:
        return "true_false"
    if "[arrange" in lower or "arrange " in lower or "chronological order" in lower:
        return "order_sequence"
    if "[fill in" in lower or "missing word" in lower or "___" in prompt or "complete the study statement" in lower:
        return "fill_blank"
    if "odd one" in lower or "does not belong" in lower or "not belong" in lower or "one is incorrect" in lower or "which name is not used" in lower:
        return "odd_one"
    return "multiple_choice"


def strip_reference(key):
    if " | " in key:
        answer, reference = key.rsplit(" | ", 1)
        return answer.strip(), reference.strip()
    for separator in (" — ", " - "):
        if separator in key:
            answer, reference = key.rsplit(separator, 1)
            if BIBLE_BOOK.match(reference):
                return answer.strip(), reference.strip()
    # Several volumes put a biblical citation in trailing parentheses.
    match = re.search(
        r"\s*\(((?:(?:[1-3]\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d+[:\d,;\-–\s]*;?\s*)+)\)$",
        key,
    )
    if match:
        return key[:match.start()].strip(), match.group(1).strip()
    return key, None


def parse_options(prompt, kind):
    if kind not in ("multiple_choice", "odd_one", "order_sequence"):
        return [], prompt
    markers = list((NUMBERED_OPTION if kind == "order_sequence" and len(NUMBERED_OPTION.findall(prompt)) >= 3 else OPTION).finditer(prompt))
    if len(markers) < 2:
        return [], prompt
    options = []
    for index, marker in enumerate(markers):
        finish = markers[index + 1].start() if index + 1 < len(markers) else len(prompt)
        options.append({"label": marker.group(1), "text": tidy(prompt[marker.end():finish]).rstrip("; ")})
    return options, tidy(prompt[:markers[0].start()])


def parse_answer(key, kind, options):
    answer, reference = strip_reference(key)
    answer = answer.strip().rstrip(".")
    if kind == "true_false":
        match = re.match(r"^(True|False)\b", answer, re.I)
        return (match.group(1).lower() if match else None), reference
    if kind == "order_sequence":
        tokens = re.findall(r"[A-E1-5]", re.split(r"\s*[—|]\s*", answer, 1)[0])
        if len(tokens) >= 3 and all(token.isdigit() for token in tokens):
            return " ".join(tokens), reference
        if len(tokens) >= 3 and all(token.isalpha() for token in tokens):
            return " ".join(tokens), reference
        return None, reference
    if kind in ("multiple_choice", "odd_one"):
        match = re.match(r"^([A-E])(?:[.)]|\s*[—-])", answer)
        if not match:
            return None, reference
        label = match.group(1)
        return (label if any(option["label"] == label for option in options) else None), reference
    if kind == "fill_blank":
        return answer.split(" — ", 1)[0].strip() or None, reference
    return None, reference


def elisha_legacy_questions():
    supplement = json.loads(Path(__file__).with_name("elisha-legacy-questions.json").read_text())
    if supplement["stage"] != 5 or len(supplement["questions"]) != 35:
        raise ValueError("Elisha's authored fifth stage must contain exactly 35 questions")
    if [item["source_number"] for item in supplement["questions"]] != list(range(201, 236)):
        raise ValueError("Elisha supplement question numbers must be 201 through 235")
    if Counter(item["type"] for item in supplement["questions"]) != {
        "true_false": 7, "multiple_choice": 10, "odd_one": 5,
        "fill_blank": 8, "order_sequence": 5,
    }:
        raise ValueError("Elisha supplement must follow the source's five-format pattern")
    prompts = [tidy(item["question"]).casefold() for item in supplement["questions"]]
    if len(set(prompts)) != len(prompts):
        raise ValueError("Elisha supplement contains a repeated question")
    result = []
    for item in supplement["questions"]:
        choices = []
        for index, option in enumerate(item.get("options", [])):
            label = chr(ord("A") + index)
            value = tidy(re.sub(r"^[A-E]\.\s*", "", option))
            choices.append({"label": label, "text": value})
        answer = item["correct_answer"]
        kind = item["type"]
        answer_label = next((choice["label"] for choice in choices if choice["text"] == answer), None)
        if kind in ("multiple_choice", "odd_one") and answer_label is None:
            raise ValueError(f"Elisha supplement #{item['source_number']} has no matching answer choice")
        if kind in ("multiple_choice", "odd_one") and len(choices) < 3:
            raise ValueError(f"Elisha supplement #{item['source_number']} has too few choices")
        if kind == "true_false" and answer not in ("true", "false"):
            raise ValueError(f"Elisha supplement #{item['source_number']} needs a true/false answer")
        if kind == "fill_blank" and "_____" not in item["question"]:
            raise ValueError(f"Elisha supplement #{item['source_number']} needs a visible blank")
        if kind == "order_sequence" and set(answer.split()) != {choice["label"] for choice in choices}:
            raise ValueError(f"Elisha supplement #{item['source_number']} has an invalid sequence")
        if kind == "order_sequence" and answer == " ".join(choice["label"] for choice in choices):
            raise ValueError(f"Elisha supplement #{item['source_number']} is already in the right order")
        if not re.fullmatch(r"2 Kings (?:8|13):[\d,;:\-\s]+", item["reference"]):
            raise ValueError(f"Elisha supplement #{item['source_number']} has an unexpected reference")
        result.append({
            "source_number": item["source_number"],
            "source_question_page": None,
            "source_answer_page": None,
            "source_kind": "authored-web-checked-supplement",
            "stage": 5,
            "type": kind,
            "question": item["question"],
            "options": choices,
            "correct_answer": answer,
            "correct_label": answer_label,
            "answer_key_text": f"{answer} ({item['reference']})",
            "reference": item["reference"],
            "review_status": "pending",
            "extraction_issues": [],
        })
    return result


def extract_volume(document, number, start, end):
    answer_start = next((i for i in range(start, end) if answer_marker_index(document[i].get_text().splitlines()) is not None), None)
    if answer_start is None:
        raise ValueError(f"Volume {number:02d} has no identifiable answer key")
    prompts, prompt_stages = extract_items(document, start, end, answer_start, False)
    keys, key_stages = extract_items(document, start, end, answer_start, True)
    issues = []
    questions = []
    expected = set(range(1, 201))
    for label, source in (("question", prompts), ("answer", keys)):
        if set(source) != expected:
            issues.append(f"{label} count {len(source)}; missing {sorted(expected - set(source))}")
    for index in sorted(set(prompts) & set(keys)):
        prompt = prompts[index]["text"]
        kind = question_type(prompt)
        options, question = parse_options(prompt, kind)
        answer_key = keys[index]["text"]
        answer, reference = parse_answer(answer_key, kind, options)
        answer_label = answer if kind in ("multiple_choice", "odd_one") else None
        if answer_label:
            answer = next(option["text"] for option in options if option["label"] == answer_label)
        stage = prompt_stages.get(index)
        if stage is None:
            stage = key_stages.get(index)
        item_issues = []
        if stage is None:
            item_issues.append("stage not identified")
        if prompt_stages.get(index) and key_stages.get(index) and prompt_stages[index] != key_stages[index]:
            item_issues.append("stage mismatch between question and key")
        if answer is None:
            item_issues.append("answer could not be parsed")
        if kind in ("multiple_choice", "odd_one", "order_sequence") and len(options) < 3:
            item_issues.append("choices could not be parsed")
        if kind == "fill_blank" and "___" not in prompt:
            item_issues.append("missing-word prompt has no blank")
        if kind == "order_sequence" and answer and len(answer.split()) != len(options):
            item_issues.append("order length does not match choices")
        if kind == "order_sequence" and answer and set(answer.split()) != {option["label"] for option in options}:
            item_issues.append("order uses invalid or repeated choices")
        if not reference:
            item_issues.append("reference not parsed")
        questions.append({
            "source_number": index,
            "source_question_page": prompts[index]["pdf_page"],
            "source_answer_page": keys[index]["pdf_page"],
            "source_kind": "supplied-pdf",
            "stage": stage,
            "type": kind,
            "question": question,
            "options": options,
            "correct_answer": answer,
            "correct_label": answer_label,
            "answer_key_text": answer_key,
            "reference": reference,
            "review_status": "pending",
            "extraction_issues": item_issues,
        })
    if number == 13:
        questions.extend(elisha_legacy_questions())
    counts = Counter(item["type"] for item in questions)
    stage_counts = Counter(item["stage"] for item in questions)
    if set(stage_counts) != set(range(1, 6)):
        issues.append(f"source contains only stages {sorted(stage for stage in stage_counts if stage is not None)}")
    prompt_groups = {}
    for item in questions:
        key = re.sub(r"\W+", " ", item["question"].casefold()).strip()
        prompt_groups.setdefault(key, []).append(item["source_number"])
    duplicate_prompts = [numbers for numbers in prompt_groups.values() if len(numbers) > 1]
    return {
        "volume": number,
        "character": VOLUME_NAMES[number - 1],
        "source_pdf_pages": [start + 1, end],
        "source_answer_key_page": answer_start + 1,
        "editorial_review_required": True,
        "question_count": len(questions),
        "type_counts": dict(counts),
        "stage_counts": {str(stage): count for stage, count in sorted(stage_counts.items(), key=lambda pair: str(pair[0]))},
        "duplicate_prompt_groups": duplicate_prompts,
        "issues": issues,
        "questions": questions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    document = fitz.open(args.pdf)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"source": args.pdf.name, "source_sha256": hashlib.sha256(args.pdf.read_bytes()).hexdigest(), "pages": len(document), "volumes": [], "ready_for_competition": False}
    for number, start, end in split_volumes(document):
        result = extract_volume(document, number, start, end)
        filename = f"volume-{number:02d}.json"
        (args.output_dir / filename).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        flagged = sum(bool(item["extraction_issues"]) for item in result["questions"])
        report["volumes"].append({
            "volume": number, "character": result["character"], "file": filename,
            "questions": result["question_count"], "type_counts": result["type_counts"],
            "stage_counts": result["stage_counts"],
            "flagged": flagged, "duplicate_prompt_groups": len(result["duplicate_prompt_groups"]),
            "questions_in_duplicate_groups": sum(len(group) for group in result["duplicate_prompt_groups"]),
            "issues": result["issues"],
        })
    (args.output_dir / "extraction-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for item in report["volumes"]:
        print(f"Volume {item['volume']:02d}: {item['character']}: {item['questions']} questions, {item['flagged']} flagged; {item['issues']}")
    print("No questions were published; editorial review is still required.")


if __name__ == "__main__":
    main()
