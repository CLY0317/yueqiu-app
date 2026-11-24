-- 给 Post / PostLike 补索引
-- Post：球友圈按 createdAt 倒序取最新，缺索引会全表扫
-- PostLike：统计每条动态的点赞数要按 postId 过滤

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "PostLike_postId_idx" ON "PostLike"("postId");
