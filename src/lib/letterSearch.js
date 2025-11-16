export function searchLetters(blocks, fingerprint, includeMetadata = false) {
  return blocks
    .flatMap((block) =>
      block.letters.map((letter) => ({
        blockIndex: block.index,
        timestamp: block.timestamp,
        ownerFingerprint: letter.ownerFingerprint,
        payload: includeMetadata ? letter.payload : undefined
      }))
    )
    .filter((entry) => entry.ownerFingerprint === fingerprint);
}
