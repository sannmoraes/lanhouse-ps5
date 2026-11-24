import unittest

import audiopacer as a


class PacerTests(unittest.TestCase):
    def test_silence_when_empty(self):
        p = a.Pacer()
        self.assertEqual(p.next(), a.SILENCE)
        self.assertEqual(len(a.SILENCE), 3840)  # 20 ms de PCM 16 bits estereo a 48 kHz

    def test_in_order(self):
        p = a.Pacer()
        c1, c2 = b"\x01" * a.CHUNK_BYTES, b"\x02" * a.CHUNK_BYTES
        p.push(c1)
        p.push(c2)
        self.assertEqual(p.next(), c1)
        self.assertEqual(p.next(), c2)
        self.assertEqual(p.next(), a.SILENCE)

    def test_drops_oldest_when_behind(self):
        p = a.Pacer(max_backlog=2)
        for i in range(5):
            p.push(bytes([i]) * a.CHUNK_BYTES)
        self.assertEqual(p.dropped, 3)
        self.assertEqual(p.next()[0], 3)  # ficam os mais novos
        self.assertEqual(p.next()[0], 4)

    def test_ignores_wrong_size(self):
        p = a.Pacer()
        p.push(b"curto")
        self.assertEqual(p.next(), a.SILENCE)


if __name__ == "__main__":
    unittest.main()
