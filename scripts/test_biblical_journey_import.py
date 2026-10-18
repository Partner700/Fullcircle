import unittest

from export_biblical_journey_import import make_payload


class JourneyImportTests(unittest.TestCase):
    def setUp(self):
        self.volume = {
            "character": "Elisha",
            "questions": [
                {
                    "source_number": 36, "source_kind": "supplied-pdf",
                    "source_question_page": 1, "source_answer_page": 2,
                    "stage": 1, "type": "order_sequence", "question": "Put the events in order.",
                    "options": [{"label": "1", "text": "Later"}, {"label": "2", "text": "First"}, {"label": "3", "text": "Last"}],
                    "correct_answer": "2 1 3", "answer_key_text": "2 1 3", "reference": "2 Kings 2:1-14",
                    "extraction_issues": [],
                },
                {
                    "source_number": 231, "source_kind": "authored-web-checked-supplement",
                    "source_question_page": None, "source_answer_page": None,
                    "stage": 5, "type": "order_sequence", "question": "Put the final events in order.",
                    "options": [{"label": "A", "text": "Later"}, {"label": "B", "text": "First"}, {"label": "C", "text": "Last"}],
                    "correct_answer": "B A C", "answer_key_text": "B A C", "reference": "2 Kings 13:20-21",
                    "extraction_issues": [],
                },
            ],
        }
        self.beats = {"elisha": ["Beginning", "Disruption", "Calling", "Preparation", "Great fight", "Recognition", "Legacy"]}

    def test_numbered_and_lettered_ordering_answers_use_same_format(self):
        payload = make_payload(self.volume, self.beats)
        self.assertEqual(payload["p_character_slug"], "elisha")
        self.assertEqual([question["correct_answer"] for question in payload["p_questions"]], ["B A C", "B A C"])
        self.assertEqual([question["source_kind"] for question in payload["p_questions"]], [
            "supplied-pdf", "authored-web-checked-supplement",
        ])
        self.assertEqual(payload["p_questions"][1]["source_question_page"], None)

    def test_flagged_source_cannot_be_exported(self):
        self.volume["questions"][0]["extraction_issues"] = ["answer could not be parsed"]
        with self.assertRaisesRegex(ValueError, "flagged extraction"):
            make_payload(self.volume, self.beats)

    def test_flagged_source_can_be_left_for_manual_repair(self):
        self.volume["questions"][0]["extraction_issues"] = ["answer could not be parsed"]
        payload = make_payload(self.volume, self.beats, skip_flagged=True)
        self.assertEqual([question["source_number"] for question in payload["p_questions"]], [231])

    def test_all_flagged_sources_cannot_be_staged(self):
        for question in self.volume["questions"]:
            question["extraction_issues"] = ["answer could not be parsed"]
        with self.assertRaisesRegex(ValueError, "no unflagged"):
            make_payload(self.volume, self.beats, skip_flagged=True)

    def test_missing_narrative_beats_cannot_be_exported(self):
        with self.assertRaisesRegex(ValueError, "seven configured"):
            make_payload(self.volume, {})


if __name__ == "__main__":
    unittest.main()
