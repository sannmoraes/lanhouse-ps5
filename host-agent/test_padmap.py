import unittest

import padmap as p


class PadMapTests(unittest.TestCase):
    def test_normalize_keeps_known_buttons_and_clamps(self):
        f = p.normalize({"t": "in", "buttons": ["cross", "up", "ps", "home", 5], "lx": 9, "ly": -9, "l2": 0.4})
        self.assertEqual(f["buttons"], frozenset({"cross", "up"}))  # botao PS e lixo sao ignorados
        self.assertEqual(f["lx"], 1.0)
        self.assertEqual(f["ly"], -1.0)
        self.assertEqual(f["l2"], 0.4)

    def test_normalize_digital_trigger_is_full(self):
        f = p.normalize({"t": "in", "buttons": ["r2"], "r2": 0})
        self.assertEqual(f["r2"], 1.0)

    def test_normalize_rejects_garbage(self):
        for bad in (None, 3, "x", {}, {"t": "turn"}, {"t": "in", "buttons": "cross"}):
            f = p.normalize(bad)
            if f is not None:  # {"t":"in","buttons":"cross"} vira quadro solto, nunca erro
                self.assertTrue(p.is_neutral(f))
        self.assertTrue(p.is_neutral(p.normalize({"t": "in", "lx": "a", "ly": float("nan"), "rx": True})))

    def test_dpad_directions(self):
        self.assertIsNone(p.dpad_direction(set()))
        self.assertEqual(p.dpad_direction({"up"}), "N")
        self.assertEqual(p.dpad_direction({"up", "right"}), "NE")
        self.assertEqual(p.dpad_direction({"down", "left"}), "SW")
        self.assertIsNone(p.dpad_direction({"up", "down"}))
        self.assertEqual(p.dpad_direction({"up", "down", "left"}), "W")

    def test_neutral_constant(self):
        self.assertTrue(p.is_neutral(p.NEUTRAL))

    def test_watchdog(self):
        self.assertFalse(p.is_stale(None, 100))
        self.assertFalse(p.is_stale(10.0, 10.5))
        self.assertTrue(p.is_stale(10.0, 10.7))

    def test_button_names_match_the_server(self):
        self.assertEqual(len(p.BUTTON_NAMES), 16)
        self.assertNotIn("ps", p.BUTTON_NAMES)


if __name__ == "__main__":
    unittest.main()
