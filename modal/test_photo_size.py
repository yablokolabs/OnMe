"""The size check that runs before a photo's pixels are decoded.

Run with: python3 -m unittest discover -s modal
"""

import unittest

from photo_size import MAX_PIXELS, too_large


class TooLarge(unittest.TestCase):
    def test_a_phone_photo_is_accepted(self):
        self.assertFalse(too_large(8160, 6120))

    def test_the_limit_itself_is_accepted(self):
        self.assertFalse(too_large(MAX_PIXELS, 1))

    def test_one_pixel_over_the_limit_is_refused(self):
        self.assertTrue(too_large(MAX_PIXELS + 1, 1))

    def test_a_small_file_that_decodes_to_a_huge_image_is_refused(self):
        self.assertTrue(too_large(20000, 20000))


if __name__ == "__main__":
    unittest.main()
