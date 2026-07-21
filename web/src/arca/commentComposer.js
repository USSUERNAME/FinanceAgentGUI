export const MAX_COMBOCON_ITEMS = 3;

export function shouldSubmitCommentFromKeyEvent(event = {}) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.nativeEvent?.isComposing &&
    event.keyCode !== 229
  );
}

export function createArcaEmoticonCommentPayload(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_COMBOCON_ITEMS) return null;
  const emoticons = items.map((item) => ({
    emoticonId: Number(item?.packageId),
    attachmentId: Number(item?.id),
  }));
  if (emoticons.some((item) => !Number.isInteger(item.emoticonId) || item.emoticonId < 0 || !Number.isInteger(item.attachmentId) || item.attachmentId <= 0)) {
    return null;
  }
  return { contentType: "emoticon", content: "", emoticons };
}
