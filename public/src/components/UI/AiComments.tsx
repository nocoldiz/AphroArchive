import { useState, useEffect } from 'preact/hooks';
import { currentVideo } from '../../store';

interface Comment {
  id: string;
  author: string;
  text: string;
  ts: number;
  isAI?: boolean;
  parentId?: string;
}

// Helper for deterministic scoring
function _hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function _baseScore(c: Comment) {
  return c.isAI ? (10 + _hash(c.id) % 990) : (1 + _hash(c.id) % 49);
}

export const AiComments = () => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<'best' | 'top' | 'new' | 'old'>('best');
  const [votes, setVotes] = useState<Record<string, number>>({});
  const video = currentVideo.value;

  useEffect(() => {
    if (video) fetchComments();
  }, [video?.id]);

  useEffect(() => {
    // Load votes from localStorage
    const savedVotes: Record<string, number> = {};
    comments.forEach(c => {
      const v = localStorage.getItem(`cw_v_${c.id}`);
      if (v) savedVotes[c.id] = parseInt(v);
    });
    setVotes(savedVotes);
  }, [comments]);

  const fetchComments = async () => {
    if (!video) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(video.id)}?name=${encodeURIComponent(video.name)}`);
      const data = await res.json();
      setComments(data);
    } catch (e) {
      console.error('Failed to fetch comments', e);
    } finally {
      setLoading(false);
    }
  };

  const submitComment = async (text: string, parentId: string | null = null) => {
    if (!video || !text.trim()) return;
    const res = await fetch(`/api/comments/${encodeURIComponent(video.id)}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, parentId, videoName: video.name })
    });
    if (res.ok) {
      const data = await res.json();
      const newComments = [...comments];
      if (data.comment) newComments.push(data.comment);
      if (data.reply) newComments.push(data.reply);
      setComments(newComments);
    }
  };

  const handleVote = (cid: string, dir: number) => {
    const cur = votes[cid] || 0;
    const newVal = cur === dir ? 0 : dir;
    const newVotes = { ...votes, [cid]: newVal };
    setVotes(newVotes);
    localStorage.setItem(`cw_v_${cid}`, String(newVal));
  };

  const getScore = (c: Comment) => _baseScore(c) + (votes[c.id] || 0);

  const sortList = (arr: Comment[]) => {
    const a = [...arr];
    if (sort === 'top') return a.sort((x, y) => getScore(y) - getScore(x));
    if (sort === 'new') return a.sort((x, y) => (y.ts || 0) - (x.ts || 0));
    if (sort === 'old') return a.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    return a.sort((x, y) => getScore(y) - getScore(x)); // best
  };

  if (!video) return null;

  const roots = sortList(comments.filter(c => !c.parentId));

  return (
    <div className="ai-comments-section" style={{ display: 'block', borderTop: '1px solid var(--brd)', marginTop: '20px', paddingTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '1px' }}>Comments</span>
          <span style={{ background: 'rgba(var(--ac-rgb,100,100,255),0.15)', color: 'var(--ac)', fontSize: '10px', padding: '2px 7px', borderRadius: '10px' }}>AI</span>
        </div>

        <div style={{ display: 'flex', gap: '4px' }}>
          {(['best', 'top', 'new', 'old'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{
                fontSize: '11px',
                fontWeight: '700',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '3px',
                color: sort === s ? 'var(--ac)' : 'var(--tx3)'
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--tx3)', fontSize: '12px' }}>Loading thoughts...</div>
      ) : (
        <div className="comments-list">
          {roots.map(c => (
            <CommentNode
              key={c.id}
              comment={c}
              allComments={comments}
              onReply={submitComment}
              getScore={getScore}
              handleVote={handleVote}
              votes={votes}
              sortList={sortList}
            />
          ))}
        </div>
      )}

      <CommentInput onSave={(text) => submitComment(text)} />
    </div>
  );
};

const CommentNode = ({ comment, allComments, onReply, getScore, handleVote, votes, sortList }: {
  comment: Comment,
  allComments: Comment[],
  onReply: (t: string, p: string) => void,
  getScore: (c: Comment) => number,
  handleVote: (cid: string, dir: number) => void,
  votes: Record<string, number>,
  sortList: (arr: Comment[]) => Comment[]
}) => {
  const [showReply, setShowReply] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const replies = sortList(allComments.filter(c => c.parentId === comment.id));
  const vote = votes[comment.id] || 0;
  const score = getScore(comment);

  const upCol = vote > 0 ? '#ff4500' : 'var(--tx3)';
  const dnCol = vote < 0 ? '#7193ff' : 'var(--tx3)';
  const scCol = vote > 0 ? '#ff4500' : vote < 0 ? '#7193ff' : 'var(--tx3)';

  return (
    <div className="comment-node" style={{ marginBottom: '12px', paddingLeft: comment.parentId ? '24px' : '0' }}>
      <div style={{ display: 'flex', gap: '10px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', color: 'var(--ac)', flexShrink: 0 }}>
          {comment.author[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{comment.author}</span>
            <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{new Date(comment.ts).toLocaleDateString()}</span>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: scCol }}>▲ {score}</span>
            {replies.length > 0 && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                style={{ background: 'none', border: 'none', color: 'var(--tx3)', fontSize: '11px', cursor: 'pointer', padding: '0 2px' }}
              >
                {collapsed ? `[+] ${replies.length} replies` : '[–]'}
              </button>
            )}
          </div>

          {collapsed ? (
            <div style={{ fontSize: '12px', color: 'var(--tx3)', paddingBottom: '4px' }}>{replies.length} replies hidden</div>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: 'var(--tx)', lineHeight: '1.4' }}>{comment.text}</div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginTop: '4px' }}>
                <button onClick={() => handleVote(comment.id, 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: upCol, padding: '2px 4px', fontSize: '12px' }}>▲</button>
                <button onClick={() => handleVote(comment.id, -1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dnCol, padding: '2px 4px', fontSize: '12px' }}>▼</button>
                <button
                  onClick={() => setShowReply(!showReply)}
                  style={{ background: 'none', border: 'none', color: 'var(--tx3)', fontSize: '11px', cursor: 'pointer', padding: '2px 8px' }}
                >
                  Reply
                </button>
              </div>
              {showReply && (
                <div style={{ marginTop: '8px' }}>
                  <CommentInput onSave={(t) => { onReply(t, comment.id); setShowReply(false); }} small />
                </div>
              )}
              {replies.map(r => (
                <CommentNode
                  key={r.id}
                  comment={r}
                  allComments={allComments}
                  onReply={onReply}
                  getScore={getScore}
                  handleVote={handleVote}
                  votes={votes}
                  sortList={sortList}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const CommentInput = ({ onSave, small }: { onSave: (text: string) => void, small?: boolean }) => {
  const [text, setText] = useState('');
  const handleSave = () => {
    if (text.trim()) {
      onSave(text);
      setText('');
    }
  };

  return (
    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
      <input
        type="text"
        value={text}
        onInput={(e: any) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        placeholder="Write a comment..."
        style={{
          flex: 1,
          background: 'var(--bg3)',
          border: '1px solid var(--brd)',
          color: 'var(--tx)',
          padding: small ? '4px 8px' : '8px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          outline: 'none'
        }}
      />
      <button
        onClick={handleSave}
        style={{ background: 'var(--ac)', color: '#fff', border: 'none', padding: '0 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
      >
        {small ? 'Reply' : 'Post'}
      </button>
    </div>
  );
};
