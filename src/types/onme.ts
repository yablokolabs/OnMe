/** The shapes OnMe stores and moves around. */

/** A photo OnMe owns a copy of, on this device. */
export interface StoredImage {
  uri: string;
  fileName: string;
  bytes: number;
  mimeType: string;
  width: number;
  height: number;
}

/** What the backend says about one generated image. */
export interface GeneratedLook {
  imageUrl: string;
  contentType: string;
  width: number;
  height: number;
  model: string;
  preservePose: boolean;
}

/** One try-on: the photo of you, the outfit, and the picture that came back. */
export interface Look {
  id: string;
  createdAt: string;
  /** The photo of you this look was made from. Null if it has since been deleted. */
  person: StoredImage | null;
  outfit: StoredImage | null;
  result: StoredImage;
  model: string;
  preservePose: boolean;
}

/** The two photos a try-on needs, as the user has them ready to send. */
export interface TryOnDraft {
  person: { base64: string; mimeType: string };
  outfit: { base64: string; mimeType: string };
  /** When the screen telling the user where the photos go was on screen. */
  consentAt: string;
}
