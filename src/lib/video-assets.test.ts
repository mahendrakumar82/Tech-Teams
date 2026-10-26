import assert from "node:assert/strict";
import test from "node:test";
import { parseTranscript } from "./parse-transcript";
import { formatStamp, transcriptFromChunks } from "./video-assets";

test("stamps stay readable after an hour", () => {
  assert.equal(formatStamp(13), "0:13");
  assert.equal(formatStamp(75 * 60), "1:15:00");
});

test("video chunks become speaker lines the meeting parser understands", () => {
  const text = transcriptFromChunks(
    "lab.mp4",
    [
      { text: " We should open. ", timestamp: [13, 16] },
      { text: "I am not sure.", timestamp: [20, 24] },
    ],
    "",
  );
  assert.match(text, /^NOTE lab\.mp4/);
  assert.match(text, /\[0:13\] Speaker: We should open\./);
  const named = parseTranscript(
    text.replace("[0:13] Speaker:", "[0:13] Morgan:").replace("[0:20] Speaker:", "[0:20] Priya:"),
  );
  assert.equal(named[0]?.speaker, "Morgan");
  assert.equal(named[1]?.speaker, "Priya");
  assert.equal(named[0]?.startMs, 13000);
});
