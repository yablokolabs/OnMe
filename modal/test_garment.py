"""The choice FASHN needs and the app never asks for: what the outfit photo shows.

Run with: python3 -m unittest discover -s modal
"""

import unittest

from garment import choose_category, choose_photo_type

PIXELS = 1000 * 1000


class ChooseCategory(unittest.TestCase):
    def test_a_top_alone_is_a_top(self):
        self.assertEqual(choose_category({"top": 300_000}), "tops")

    def test_trousers_alone_are_bottoms(self):
        self.assertEqual(choose_category({"pants": 250_000}), "bottoms")

    def test_a_skirt_alone_is_bottoms(self):
        self.assertEqual(choose_category({"skirt": 200_000}), "bottoms")

    def test_a_dress_is_a_one_piece(self):
        self.assertEqual(choose_category({"dress": 400_000}), "one-pieces")

    def test_a_dress_with_a_little_top_detected_is_still_a_one_piece(self):
        self.assertEqual(choose_category({"dress": 300_000, "top": 60_000}), "one-pieces")

    def test_a_whole_outfit_is_a_one_piece(self):
        self.assertEqual(choose_category({"top": 200_000, "pants": 200_000}), "one-pieces")

    def test_a_top_with_a_sliver_of_trousers_is_a_top(self):
        self.assertEqual(choose_category({"top": 300_000, "pants": 20_000}), "tops")

    def test_trousers_with_a_sliver_of_top_are_bottoms(self):
        self.assertEqual(choose_category({"pants": 300_000, "top": 20_000}), "bottoms")

    def test_no_garment_found_falls_back_to_a_top(self):
        self.assertEqual(choose_category({}), "tops")
        self.assertEqual(choose_category({"face": 50_000, "background": 900_000}), "tops")


class ChoosePhotoType(unittest.TestCase):
    def test_a_garment_worn_by_someone_is_a_model_photo(self):
        counts = {"top": 200_000, "face": 20_000, "arms": 40_000}
        self.assertEqual(choose_photo_type(counts, PIXELS), "model")

    def test_a_garment_on_its_own_is_a_flat_lay(self):
        self.assertEqual(choose_photo_type({"top": 300_000, "background": 700_000}, PIXELS), "flat-lay")

    def test_a_few_stray_skin_pixels_do_not_make_a_model_photo(self):
        counts = {"top": 300_000, "arms": 2_000}
        self.assertEqual(choose_photo_type(counts, PIXELS), "flat-lay")

    def test_an_empty_image_is_a_flat_lay(self):
        self.assertEqual(choose_photo_type({}, 0), "flat-lay")


if __name__ == "__main__":
    unittest.main()
