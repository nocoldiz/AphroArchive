import { useState, useEffect } from 'preact/hooks';
import { currentVideo } from '../store';

interface Comment {
  id: string;
  author: string;
  text: string;
  ts: number;
  isAI?: boolean;
  parentId?: string;
}

export const AiComments = () => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const video = currentVideo.value;

  useEffect(() => {
    if (video) fetchComments();
  }, [video?.id]);

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
      // Server returns { comment, reply? }
      const newComments = [...comments];
      if (data.comment) newComments.push(data.comment);
      if (data.reply) newComments.push(data.reply);
      setComments(newComments);
    }
  };

  if (!video) return null;

  return (
    <div className="ai-comments-section" style={{ display: 'block', borderTop: '1px solid var(--brd)', marginTop: '20px', paddingTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '1px' }}>Comments</span>
        <span style={{ background: 'rgba(var(--ac-rgb,100,100,255),0.15)', color: 'var(--ac)', fontSize: '10px', padding: '2px 7px', borderRadius: '10px' }}>AI</span>
      </div>

      {loading ? (
        <div style={{ color: 'var(--tx3)', fontSize: '12px' }}>Loading thoughts...</div>
      ) : (
        <div className="comments-list">
          {comments.filter(c => !c.parentId).map(c => (
            <CommentNode key={c.id} comment={c} allComments={comments} onReply={submitComment} />
          ))}
        </div>
      )}

      <CommentInput onSave={(text) => submitComment(text)} />
    </div>
  );
};

const CommentNode = ({ comment, allComments, onReply }: { comment: Comment, allComments: Comment[], onReply: (t: string, p: string) => void }) => {
  const [showReply, setShowReply] = useState(false);
  const replies = allComments.filter(c => c.parentId === comment.id);

  return (
    <div className="comment-node" style={{ marginBottom: '12px', paddingLeft: comment.parentId ? '24px' : '0' }}>
      <div style={{ display: 'flex', gap: '10px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyCenter: 'center', fontSize: '12px', fontWeight: 'bold', color: 'var(--ac)', flexShrink: 0 }}>
          {comment.author[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{comment.author}</span>
            <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>{new Date(comment.ts).toLocaleDateString()}</span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--tx)', lineHeight: '1.4' }}>{comment.text}</div>
          <div style={{ marginTop: '4px' }}>
            <button 
              onClick={() => setShowReply(!showReply)}
              style={{ background: 'none', border: 'none', color: 'var(--ac)', fontSize: '11px', cursor: 'pointer', padding: '0' }}
            >
              Reply
            </button>
          </div>
          {showReply && (
            <div style={{ marginTop: '8px' }}>
              <CommentInput onSave={(t) => { onReply(t, comment.id); setShowReply(false); }} small />
            </div>
          )}
        </div>
      </div>
      {replies.map(r => (
        <CommentNode key={r.id} comment={r} allComments={allComments} onReply={onReply} />
      ))}
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
