import unittest

from videowatch import VideoWatch


def feed(*samples):
    it = iter(samples)

    def fetch():
        s = next(it)
        if isinstance(s, Exception):
            raise s
        return s

    return fetch


class VideoWatchTests(unittest.TestCase):
    def test_growing_bytes_is_live(self):
        w = VideoWatch(feed({"ready": True, "inboundBytes": 100}, {"ready": True, "inboundBytes": 900}))
        self.assertTrue(w.check())  # primeira leitura
        self.assertTrue(w.check())

    def test_frozen_bytes_is_not_live(self):
        w = VideoWatch(feed({"ready": True, "inboundBytes": 500}, {"ready": True, "inboundBytes": 500}))
        self.assertTrue(w.check())
        self.assertFalse(w.check())  # nada novo em 5 s: congelou

    def test_not_ready_and_errors(self):
        w = VideoWatch(feed({"ready": False}, OSError("fora do ar"), {"ready": True, "inboundBytes": 10}))
        self.assertFalse(w.check())
        self.assertFalse(w.check())
        self.assertTrue(w.check())  # voltou: comeca de novo

    def test_old_field_name_and_missing_counter(self):
        w = VideoWatch(feed({"ready": True, "bytesReceived": 1}, {"ready": True, "bytesReceived": 2}))
        self.assertTrue(w.check())
        self.assertTrue(w.check())
        self.assertTrue(VideoWatch(feed({"ready": True})).check())

    def test_garbage(self):
        self.assertFalse(VideoWatch(feed("texto")).check())


if __name__ == "__main__":
    unittest.main()
