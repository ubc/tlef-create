import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, ExternalLink, HelpCircle, Loader2, MessageCircle, RotateCcw, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { API_URL } from '../../config/api';
import { useFeatureOnboarding } from '../../hooks/useFeatureOnboarding';
import { notifyAuthExpired } from '../../utils/authEvents';
import '../../styles/components/CreateGuide.css';
import FeatureCoachmark from '../onboarding/FeatureCoachmark';
import GuideFeedback, { GuideRating } from './GuideFeedback';

interface HelpSource {
  id: string;
  citationIndex: number;
  title: string;
  section: string;
  excerpt: string;
  sourcePath: string;
  documentId?: string;
  sectionId?: string;
  navigationPath?: string | null;
}

interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: HelpSource[];
  isError?: boolean;
  interactionId?: string;
  rating?: GuideRating;
}

interface PageContext {
  route: string;
  pageTitle: string;
  activeTab: string;
}

const STORAGE_KEY = 'tlef-create-guide-messages';
const WELCOME_MESSAGE: HelpMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hi, I am CREATE Guide. Ask me how to use materials, learning objectives, the AI Blueprint, question review, prompts, or exports.'
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `help-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPageContext(pathname: string, search: string): PageContext {
  const activeTab = document.querySelector('.quiz-tab.active')?.textContent?.trim()
    || new URLSearchParams(search).get('tab')
    || '';
  let pageTitle = 'Dashboard';
  if (pathname.includes('/quiz/')) pageTitle = 'Quiz workflow';
  else if (pathname.startsWith('/course/')) pageTitle = 'Course';
  else if (pathname.startsWith('/account')) pageTitle = 'User account';
  else if (pathname.startsWith('/help')) pageTitle = 'Help Center';
  else if (pathname.startsWith('/admin')) pageTitle = 'Admin';
  return { route: `${pathname}${search}`, pageTitle, activeTab };
}

function suggestionsFor(pathname: string, activeTab: string) {
  const tab = activeTab.toLowerCase();
  if (tab.includes('objective')) return ['How should I generate learning objectives?', 'What are LO subpoints?', 'How do source references work?'];
  if (tab.includes('review')) return ['How do I make a multiple-answer question?', 'What do hint and answer feedback mean?', 'How do I inspect question evidence?'];
  if (tab.includes('generate') || pathname.includes('/quiz/')) return ['How does AI choose the question count?', 'Which package format should I use?', 'How does CREATE avoid repetitive questions?'];
  if (pathname.startsWith('/course/')) return ['How should I organize course materials?', 'How do course prompts work?', 'How do I create a new quiz?'];
  return ['How do I get started?', 'What can I export?', 'What is the recommended CREATE workflow?'];
}

function parseEventBlock(block: string) {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> };
}

function renderMessageContent(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>
      : part
  ));
}

const CreateGuide = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const guideTutorial = useFeatureOnboarding('create-guide');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [WELCOME_MESSAGE];
    } catch {
      return [WELCOME_MESSAGE];
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clearConversation = () => {
    abortRef.current?.abort();
    setMessages([WELCOME_MESSAGE]);
    setStatus('');
    setIsStreaming(false);
  };

  const updateAssistant = (id: string, update: Partial<HelpMessage>) => {
    setMessages(current => current.map(message => message.id === id ? { ...message, ...update } : message));
  };

  const appendAssistantText = (id: string, chunk: string) => {
    setMessages(current => current.map(message => (
      message.id === id ? { ...message, content: `${message.content}${chunk}` } : message
    )));
  };

  const sendMessage = async (rawMessage: string) => {
    const content = rawMessage.trim();
    if (!content || isStreaming) return;

    const userMessage: HelpMessage = { id: makeId(), role: 'user', content };
    const assistantId = makeId();
    const history = messages.filter(message => message.content).slice(-8).map(({ role, content: text }) => ({ role, content: text }));
    const context = getPageContext(location.pathname, location.search);

    setMessages(current => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setIsStreaming(true);
    setStatus('Searching CREATE help...');
    abortRef.current = new AbortController();

    try {
      const response = await fetch(`${API_URL}/api/create/help/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: content, history, context }),
        signal: abortRef.current.signal
      });

      if (response.status === 401) {
        notifyAuthExpired();
        throw new Error('Your session has expired. Please sign in again.');
      }
      if (!response.ok || !response.body) throw new Error('CREATE Guide is temporarily unavailable.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const parsed = parseEventBlock(block);
          if (!parsed) continue;
          if (parsed.event === 'text-chunk') appendAssistantText(assistantId, String(parsed.data.chunk || ''));
          if (parsed.event === 'status') setStatus(String(parsed.data.message || ''));
          if (parsed.event === 'sources') updateAssistant(assistantId, { sources: parsed.data.sources as HelpSource[] });
          if (parsed.event === 'error') throw new Error(String(parsed.data.message || 'CREATE Guide could not answer.'));
          if (parsed.event === 'complete') {
            updateAssistant(assistantId, { interactionId: String(parsed.data.interactionId || '') || undefined });
            setStatus('');
          }
        }
        if (done) break;
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        updateAssistant(assistantId, {
          content: (error as Error).message || 'CREATE Guide could not answer this question.',
          isError: true
        });
      }
    } finally {
      setStatus('');
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const context = getPageContext(location.pathname, location.search);
  const suggestions = suggestionsFor(location.pathname, context.activeTab);

  const openGuide = () => {
    guideTutorial.complete();
    setIsOpen(true);
  };

  return (
    <div className={`create-guide ${isOpen ? 'is-open' : ''}`}>
      {isOpen && (
        <section className="create-guide-panel" role="dialog" aria-label="CREATE Guide">
          <header className="create-guide-header">
            <div className="create-guide-identity">
              <span className="create-guide-mark"><BookOpen size={19} /></span>
              <div><strong>CREATE Guide</strong><span>Help for this page</span></div>
            </div>
            <div className="create-guide-header-actions">
              <button type="button" onClick={clearConversation} aria-label="Clear conversation" title="Clear conversation"><RotateCcw size={17} /></button>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close CREATE Guide"><X size={19} /></button>
            </div>
          </header>

          <div className="create-guide-context"><HelpCircle size={14} /> {context.activeTab || context.pageTitle}</div>

          <div className="create-guide-messages" aria-live="polite">
            {messages.map(message => (
              <article key={message.id} className={`create-guide-message ${message.role} ${message.isError ? 'error' : ''}`}>
                <div className="create-guide-message-copy">
                  {message.content
                    ? renderMessageContent(message.content)
                    : (isStreaming && message.role === 'assistant' ? <span className="create-guide-thinking"><Loader2 size={15} /> Thinking</span> : null)}
                </div>
                {message.sources && message.sources.length > 0 && (
                  <div className="create-guide-sources">
                    <span>Sources</span>
                    {message.sources.slice(0, 3).map(source => (
                      <Link
                        key={source.id}
                        className="create-guide-source"
                        to={source.navigationPath || '/help'}
                        onClick={() => {
                          if (source.documentId && source.sectionId) {
                            window.dispatchEvent(new CustomEvent('tlef:help-reference', {
                              detail: { documentId: source.documentId, sectionId: source.sectionId }
                            }));
                          }
                        }}
                        aria-label={`Open ${source.title}, ${source.section} in the Help Center`}
                      >
                        <span>[{source.citationIndex}] {source.title}</span>
                        <small>{source.section}</small>
                        {source.navigationPath && <ExternalLink size={13} />}
                      </Link>
                    ))}
                  </div>
                )}
                {message.role === 'assistant' && message.interactionId && !message.isError && (
                  <GuideFeedback
                    interactionId={message.interactionId}
                    currentRating={message.rating}
                    onRated={rating => updateAssistant(message.id, { rating })}
                  />
                )}
              </article>
            ))}
            {status && <div className="create-guide-status"><Loader2 size={14} /> {status}</div>}
            <div ref={messageEndRef} />
          </div>

          {messages.length <= 1 && (
            <div className="create-guide-suggestions">
              {suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}
            </div>
          )}

          <form className="create-guide-composer" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask how to use CREATE..."
              rows={2}
              maxLength={2000}
              disabled={isStreaming}
            />
            <button type="submit" disabled={!input.trim() || isStreaming} aria-label="Send message"><ArrowUp size={18} /></button>
          </form>
          <footer>CREATE Guide cannot modify your course. Questions and ratings may be reviewed by administrators to improve CREATE.</footer>
        </section>
      )}

      <FeatureCoachmark
        isOpen={guideTutorial.isActive && !isOpen}
        title="Meet your CREATE Guide"
        description="This AI help chat stays available in the bottom-right corner. Ask about the page you are viewing, workflow choices, exports, or troubleshooting. It explains CREATE without changing your course."
        eyebrow="AI help chat"
        primaryLabel="Try CREATE Guide"
        placement="top-end"
        onPrimary={openGuide}
        onDismiss={guideTutorial.complete}
        onSkip={guideTutorial.skipAll}
      >
        <button
          type="button"
          className="create-guide-launcher"
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
            } else {
              openGuide();
            }
          }}
          aria-label={isOpen ? 'Close CREATE Guide' : 'Open CREATE Guide'}
          aria-expanded={isOpen}
        >
          {isOpen ? <X size={24} /> : <MessageCircle size={25} />}
        </button>
      </FeatureCoachmark>
    </div>
  );
};

export default CreateGuide;
