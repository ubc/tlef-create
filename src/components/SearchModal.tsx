import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, MessageSquare, Target, X } from 'lucide-react';
import { foldersApi, materialsApi, quizApi, searchApi, SearchResult } from '../services/api';
import '../styles/components/SearchModal.css';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SearchModal = ({ isOpen, onClose }: SearchModalProps) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [openingResultId, setOpeningResultId] = useState<string | null>(null);
  const [resultError, setResultError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchRequestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedIndex(0);
      setOpeningResultId(null);
      setResultError('');
    }
  }, [isOpen]);

  // Handle search with debouncing
  useEffect(() => {
    const requestId = ++searchRequestIdRef.current;
    setResultError('');
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If query is empty, clear results
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Debounce search - wait 300ms after user stops typing
    searchTimeoutRef.current = setTimeout(async () => {
      if (searchQuery.trim().length < 2) return;

      setIsSearching(true);
      try {
        const response = await searchApi.search(searchQuery);
        if (requestId !== searchRequestIdRef.current) return;
        setSearchResults(response.data?.results || []);
        setSelectedIndex(0);
      } catch (error) {
        if (requestId !== searchRequestIdRef.current) return;
        console.error('Search error:', error);
        setSearchResults([]);
        setResultError('Search could not be completed. Please retry.');
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      if (searchResults.length === 0) return;
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      if (searchResults.length === 0) return;
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      handleResultClick(searchResults[selectedIndex]);
    }
  };

  // Handle result click
  const handleResultClick = async (result: SearchResult) => {
    if (openingResultId) return;

    setOpeningResultId(result.id);
    setResultError('');
    try {
      if (!result.courseId) {
        throw new Error('The result is missing its course.');
      }

      let navigationPath: string;
      if (result.type === 'material') {
        await Promise.all([
          foldersApi.getFolder(result.courseId),
          materialsApi.getProcessingStatus(result.id)
        ]);
        navigationPath = `/course/${result.courseId}`;
      } else {
        if (!result.quizId) {
          throw new Error('The result is missing its quiz.');
        }
        const [response] = await Promise.all([
          quizApi.getQuiz(result.quizId),
          foldersApi.getFolder(result.courseId)
        ]);
        const folderValue = response.quiz.folder as unknown;
        const resolvedCourseId = typeof folderValue === 'string'
          ? folderValue
          : folderValue && typeof folderValue === 'object' && '_id' in folderValue
            ? String((folderValue as { _id: unknown })._id)
            : '';
        if (resolvedCourseId && resolvedCourseId !== result.courseId) {
          throw new Error('The result no longer belongs to this course.');
        }

        navigationPath = result.type === 'question'
          ? `/course/${result.courseId}/quiz/${result.quizId}?tab=review&questionId=${result.id}`
          : `/course/${result.courseId}/quiz/${result.quizId}?tab=objectives`;
      }

      navigate(navigationPath);
      onClose();
    } catch (error) {
      console.warn('Search result is no longer available:', error);
      setSearchResults(previous => previous.filter(candidate => (
        candidate.type !== result.type || candidate.id !== result.id
      )));
      setSelectedIndex(0);
      setResultError('That result is no longer available or you no longer have access. It was removed from the list.');
    } finally {
      setOpeningResultId(null);
    }
  };

  // Get icon for search result type
  const getSearchResultIcon = (type: string) => {
    switch (type) {
      case 'material':
        return <FileText size={20} />;
      case 'question':
        return <MessageSquare size={20} />;
      case 'learning-objective':
        return <Target size={20} />;
      default:
        return <FileText size={20} />;
    }
  };

  // Get label for search result type
  const getSearchResultTypeLabel = (type: string) => {
    switch (type) {
      case 'material':
        return 'Material';
      case 'question':
        return 'Question';
      case 'learning-objective':
        return 'Learning Objective';
      default:
        return type;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-header">
          <div className="search-modal-input-wrapper">
            <Search size={20} className="search-modal-icon" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search materials, questions, and learning objectives..."
              className="search-modal-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="search-modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="search-modal-content">
          {resultError && (
            <div className="search-modal-error" role="alert">
              {resultError}
            </div>
          )}
          {isSearching ? (
            <div className="search-modal-loading">
              <div className="spinner"></div>
              <span>Searching...</span>
            </div>
          ) : searchQuery.trim() === '' ? (
            <div className="search-modal-empty">
              <Search size={48} className="search-modal-empty-icon" />
              <p>Search across all your course materials, questions, and learning objectives</p>
              <div className="search-modal-tips">
                <div className="search-tip">
                  <kbd>↑</kbd> <kbd>↓</kbd> to navigate
                </div>
                <div className="search-tip">
                  <kbd>Enter</kbd> to select
                </div>
                <div className="search-tip">
                  <kbd>Esc</kbd> to close
                </div>
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="search-modal-no-results">
              <p>No results found for "{searchQuery}"</p>
              <span>Try different keywords or check your spelling</span>
            </div>
          ) : (
            <div className="search-modal-results">
              {searchResults.map((result, index) => (
                <div
                  key={`${result.type}-${result.id}`}
                  className={`search-result-card ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleResultClick(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  aria-busy={openingResultId === result.id}
                >
                  <div className="search-result-icon-badge">
                    {getSearchResultIcon(result.type)}
                  </div>
                  <div className="search-result-details">
                    <div className="search-result-header">
                      <h3 className="search-result-title">{result.title}</h3>
                      <span className="search-result-type-badge">
                        {getSearchResultTypeLabel(result.type)}
                      </span>
                    </div>
                    {result.snippet && (
                      <p className="search-result-snippet">{result.snippet}</p>
                    )}
                    <div className="search-result-breadcrumb">
                      <span>{result.courseName}</span>
                      {result.quizName && (
                        <>
                          <span className="breadcrumb-separator">›</span>
                          <span>{result.quizName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="search-modal-footer">
            <span>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchModal;
