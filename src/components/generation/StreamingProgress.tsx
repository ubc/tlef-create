import { Loader, CheckCircle } from 'lucide-react';
import { StreamingState } from './generationTypes';

interface StreamingProgressProps {
  streamingState: StreamingState;
  connectionStatus: string;
  onStopGeneration: () => void;
}

const StreamingProgress = ({ streamingState, connectionStatus, onStopGeneration }: StreamingProgressProps) => {
  return (
    <div className="streaming-phase">
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Loader className="spinning" size={20} />
            Generating Questions in Real-time
          </h3>
          <p className="card-description">
            Questions are being generated with AI streaming. Watch them appear as they're created!
          </p>
        </div>

        {/* Connection Status */}
        <div className="streaming-status">
          <div className={`connection-indicator ${connectionStatus}`}>
            <div className="status-dot"></div>
            <span>
              {connectionStatus === 'connected' && 'Connected to streaming service'}
              {connectionStatus === 'connecting' && 'Connecting to streaming service...'}
              {connectionStatus === 'disconnected' && 'Disconnected from streaming service'}
              {connectionStatus === 'error' && 'Connection error - attempting to reconnect...'}
            </span>
          </div>
        </div>

        {/* Batch Progress */}
        {streamingState.batchStarted && (
          <div className="batch-progress">
            <div className="progress-header">
              <h4>Generation Progress</h4>
              <span className="progress-count">
                {streamingState.completedQuestions.length} / {streamingState.totalQuestions} completed
              </span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(streamingState.completedQuestions.length / streamingState.totalQuestions) * 100}%`
                }}
              ></div>
            </div>
          </div>
        )}

        {/* Questions in Progress */}
        {streamingState.questionsInProgress.size > 0 && (
          <div className="questions-in-progress">
            <h4>Currently Generating</h4>
            <div className="progress-questions">
              {Array.from(streamingState.questionsInProgress.values()).map((questionProgress) => (
                <div key={questionProgress.questionId} className="progress-question">
                  <div className="question-header">
                    <span className="question-type">{questionProgress.type.replace('-', ' ')}</span>
                    <span className="question-status">{questionProgress.progress}</span>
                  </div>
                  {questionProgress.chunks.length > 0 && (
                    <div className="streaming-text">
                      <div className="text-preview">
                        {questionProgress.chunks.join('')}
                        <span className="cursor-blink">|</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed Questions Preview */}
        {streamingState.completedQuestions.length > 0 && (
          <div className="completed-questions-preview">
            <h4>Recently Completed</h4>
            <div className="completed-list">
              {streamingState.completedQuestions.slice(-3).map((question, index) => (
                <div key={index} className="completed-question">
                  <div className="question-preview">
                    <span className="question-type">{question.type?.replace('-', ' ')}</span>
                    <span className="question-text">
                      {question.questionText?.substring(0, 100)}
                      {question.questionText?.length > 100 && '...'}
                    </span>
                    <CheckCircle size={16} className="completed-icon" />
                  </div>
                </div>
              ))}
              {streamingState.completedQuestions.length > 3 && (
                <div className="more-completed">
                  + {streamingState.completedQuestions.length - 3} more completed
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stop Streaming Button */}
        <div className="streaming-actions">
          <button className="btn btn-secondary" onClick={onStopGeneration}>
            Stop Generation
          </button>
        </div>
      </div>
    </div>
  );
};

export default StreamingProgress;
