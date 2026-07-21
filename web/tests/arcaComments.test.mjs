import assert from "node:assert/strict";
import test from "node:test";

import {
  arcaMediaProxyPath,
  buildArcaCommentFormData,
  extractArcaCommentsFromHtml,
  normalizeArcaCommentWrite,
} from "../server/arcaApi.mjs";

test("댓글과 연속 답글의 계층, 작성 권한을 추출한다", () => {
  const html = `
    <section class="article-comment">
      <div class="comment-wrapper">
        <div class="comment-item" id="c_100">
          <div class="info-row">
            <span class="user-info author"><a data-filter="글쓴이#123">글쓴이</a></span>
            <time datetime="2026-07-21T10:00:00.000Z"></time>
          </div>
          <div class="message"><div class="text"><pre>첫 댓글</pre></div></div>
        </div>
      </div>
      <div class="comment-wrapper">
        <div class="comment-item" id="c_101">
          <div class="info-row">
            <a href="/b/stock/1?#c_100">부모</a>
            <span class="user-info"><a data-filter="답글러">답글러</a></span>
          </div>
          <div class="message"><div class="text"><pre>첫 답글</pre></div></div>
        </div>
      </div>
      <div class="comment-wrapper">
        <div class="comment-item" id="c_102">
          <div class="info-row">
            <a href="/b/stock/1?#c_101">부모</a>
            <span class="user-info"><a data-filter="재답글러">재답글러</a></span>
          </div>
          <div class="message"><div class="text"><pre>두 번째 답글</pre></div></div>
        </div>
      </div>
    </section>
    <form class="reply-form write" id="commentForm" action="/b/stock/1/comment" method="post">
      <input type="hidden" name="_csrf" value="test-token" />
      <input class="reply-form-user-input" value="로그인 사용자" disabled />
    </form>
  `;

  const result = extractArcaCommentsFromHtml(html);

  assert.equal(result.comments.length, 3);
  assert.deepEqual(result.comments.map((comment) => comment.parentId), [null, "100", "101"]);
  assert.deepEqual(result.comments.map((comment) => comment.depth), [0, 1, 2]);
  assert.equal(result.comments[0].articleAuthor, true);
  assert.equal(result.commenting.canComment, true);
  assert.equal(result.commenting.currentUser, "로그인 사용자");
  assert.equal(result.commenting.supportsVoice, false);
});

test("정적·동영상 아카콘을 허용된 로컬 미디어 프록시로 변환한다", () => {
  const html = `
    <div class="comment-item" id="c_200">
      <div class="info-row"><span class="user-info" data-filter="아카콘 사용자"></span></div>
      <div class="message">
        <div class="emoticon-wrapper">
          <img class="emoticon" data-id="901" src="//ac-p1.namu.la/static.png?key=one" />
          <video class="emoticon" data-id="902" src="//ac-p1.namu.la/motion.mp4?key=two" poster="//ac-p1.namu.la/motion.webp?key=three"></video>
        </div>
      </div>
    </div>
  `;

  const { comments } = extractArcaCommentsFromHtml(html);

  assert.equal(comments[0].emoticons.length, 2);
  assert.deepEqual(comments[0].emoticons.map((media) => media.type), ["image", "video"]);
  assert.equal(comments[0].emoticons[0].attachmentId, 901);
  assert.equal(
    comments[0].emoticons[0].src,
    arcaMediaProxyPath("https://ac-p1.namu.la/static.png?key=one")
  );
  assert.equal(
    comments[0].emoticons[1].poster,
    arcaMediaProxyPath("https://ac-p1.namu.la/motion.webp?key=three")
  );
});

test("기본 Gravatar 아바타만 로컬 미디어 프록시로 변환한다", () => {
  const gravatarUrl = "https://secure.gravatar.com/avatar/test-hash?d=retro&f=y";
  const html = `
    <div class="comment-item" id="c_300">
      <div class="avatar"><img src="${gravatarUrl}" /></div>
      <div class="info-row"><span class="user-info"><a data-filter="기본 아바타">기본 아바타</a></span></div>
      <div class="message"><div class="text"><pre>댓글</pre></div></div>
    </div>
    <div class="comment-item" id="c_301">
      <div class="avatar"><img src="https://example.com/untrusted.png" /></div>
      <div class="info-row"><span class="user-info"><a data-filter="외부 아바타">외부 아바타</a></span></div>
      <div class="message"><div class="text"><pre>댓글</pre></div></div>
    </div>
  `;

  const { comments } = extractArcaCommentsFromHtml(html);

  assert.equal(comments[0].avatar, arcaMediaProxyPath(gravatarUrl));
  assert.equal(comments[1].avatar, "");
});

test("콤보콘은 최대 3개를 순서와 중복을 유지해 정규화한다", () => {
  const comment = normalizeArcaCommentWrite({
    contentType: "emoticon",
    parentId: "939508609",
    emoticons: [
      { packageId: 10, id: 101 },
      { packageId: 20, id: 202 },
      { packageId: 20, id: 202 },
    ],
  });

  assert.deepEqual(comment, {
    contentType: "emoticon",
    content: "",
    parentId: 939508609,
    emoticons: [
      { emoticonId: 10, attachmentId: 101 },
      { emoticonId: 20, attachmentId: 202 },
      { emoticonId: 20, attachmentId: 202 },
    ],
  });
  assert.equal(normalizeArcaCommentWrite({
    contentType: "emoticon",
    emoticons: [
      { packageId: 1, id: 1 },
      { packageId: 1, id: 2 },
      { packageId: 1, id: 3 },
      { packageId: 1, id: 4 },
    ],
  }), null);
});

test("콤보콘 폼은 동일한 필드 이름을 선택 순서대로 반복한다", () => {
  const formData = buildArcaCommentFormData({
    contentType: "emoticon",
    content: "",
    parentId: 300,
    emoticons: [
      { emoticonId: 10, attachmentId: 101 },
      { emoticonId: 20, attachmentId: 202 },
      { emoticonId: 20, attachmentId: 202 },
    ],
  }, "csrf-token");

  assert.deepEqual(formData.getAll("emoticonId"), ["10", "20", "20"]);
  assert.deepEqual(formData.getAll("attachmentId"), ["101", "202", "202"]);
  assert.equal(formData.get("parentId"), "300");
});
