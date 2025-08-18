import fetch from 'node-fetch';

class OllamaService {
  constructor() {
    this.endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    this.model = 'llama3.1:8b';
  }

  async generateText(prompt, options = {}) {
    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 2000,
            ...options
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Ollama service error:', error);
      throw new Error(`Failed to generate text: ${error.message}`);
    }
  }

  /**
   * Generate learning objectives from course materials
   */
  async generateLearningObjectives(materials, courseContext = '', targetCount = null) {
    // Prepare materials content for the prompt
    const materialsContent = materials.map(material => {
      let content = '';
      if (material.content) {
        content = material.content.substring(0, 3000); // Limit content length
      }
      return `**${material.name}** (${material.type})\n${content}`;
    }).join('\n\n---\n\n');

    const countInstruction = targetCount ? `exactly ${targetCount}` : '4-6';
    const prompt = `You are an educational expert helping to create learning objectives for a university course. Based on the provided course materials, generate ${countInstruction} specific, measurable learning objectives that students should achieve.

Course Materials:
${materialsContent}

${courseContext ? `Course Context: ${courseContext}` : ''}

Please generate learning objectives that:
1. Use action verbs (analyze, evaluate, create, apply, etc.)
2. Are specific and measurable
3. Are appropriate for university-level students
4. Cover the key concepts from the materials
5. Follow Bloom's taxonomy principles

Format your response as a JSON array of strings, like this:
["Students will be able to analyze...", "Students will demonstrate understanding of...", "Students will evaluate..."]

Learning Objectives:`;

    try {
      const response = await this.generateText(prompt, {
        temperature: 0.6, // Slightly lower for more consistent educational content
        max_tokens: 1000
      });

      // Try to parse JSON response
      try {
        // Look for JSON array in the response
        const jsonMatch = response.match(/\[(.*?)\]/s);
        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          const objectives = JSON.parse(jsonStr);
          return objectives.filter(obj => obj && obj.trim().length > 0);
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON response, falling back to text parsing');
      }

      // Fallback: Extract objectives from text response
      const lines = response.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('Learning Objectives:'))
        .filter(line => line.match(/^[\d\-\*]?\.?\s*Students? will/i))
        .map(line => line.replace(/^[\d\-\*]?\.?\s*/, '').trim())
        .slice(0, 6); // Limit to 6 objectives

      if (lines.length === 0) {
        throw new Error('No valid learning objectives found in response');
      }

      return lines;
    } catch (error) {
      console.error('Error generating learning objectives:', error);
      throw error;
    }
  }

  /**
   * Classify user-provided text into individual learning objectives
   */
  async classifyLearningObjectives(inputText) {
    const prompt = `You are an educational expert. The user has provided text that contains learning objectives. Please extract and classify them into individual, well-formatted learning objectives.

User Input:
"${inputText}"

Please:
1. Extract individual learning objectives from the text
2. Reformat them to start with "Students will be able to..." or "Students will..."
3. Ensure each objective is specific and measurable
4. Remove any duplicates or overlapping objectives
5. Clean up grammar and formatting

Format your response as a JSON array of strings, like this:
["Students will be able to analyze...", "Students will demonstrate understanding of...", "Students will evaluate..."]

Learning Objectives:`;

    try {
      const response = await this.generateText(prompt, {
        temperature: 0.5, // Lower temperature for more consistent formatting
        max_tokens: 800
      });

      // Try to parse JSON response
      try {
        const jsonMatch = response.match(/\[(.*?)\]/s);
        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          const objectives = JSON.parse(jsonStr);
          return objectives.filter(obj => obj && obj.trim().length > 0);
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON response, falling back to text parsing');
      }

      // Fallback: Extract objectives from text response
      const lines = response.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('Learning Objectives:'))
        .filter(line => line.match(/^[\d\-\*]?\.?\s*Students? will/i))
        .map(line => line.replace(/^[\d\-\*]?\.?\s*/, '').trim())
        .slice(0, 8); // Allow up to 8 from user input

      if (lines.length === 0) {
        // If no "Students will" format found, try to extract any objectives
        const allLines = inputText.split('\n')
          .map(line => line.trim())
          .filter(line => line && line.length > 10)
          .map(line => {
            // Add "Students will be able to" if not present
            if (!line.match(/^Students? will/i)) {
              return `Students will be able to ${line.toLowerCase()}`;
            }
            return line;
          })
          .slice(0, 8);

        return allLines;
      }

      return lines;
    } catch (error) {
      console.error('Error classifying learning objectives:', error);
      throw error;
    }
  }

  /**
   * Regenerate a single learning objective
   */
  async regenerateSingleObjective(currentObjective, materials, courseContext = '') {
    // Prepare materials content for context
    const materialsContent = materials.map(material => {
      let content = '';
      if (material.content) {
        content = material.content.substring(0, 2000); // Limit content length
      }
      return `**${material.name}** (${material.type})\n${content}`;
    }).join('\n\n---\n\n');

    const prompt = `You are an educational expert. Based on the provided course materials, improve and regenerate this learning objective to be more specific, measurable, and aligned with the content.

Course Materials:
${materialsContent}

${courseContext ? `Course Context: ${courseContext}` : ''}

Current Learning Objective:
"${currentObjective}"

Please regenerate this learning objective to:
1. Be more specific and measurable
2. Use appropriate action verbs (analyze, evaluate, create, apply, etc.)
3. Better align with the course materials provided
4. Follow Bloom's taxonomy principles
5. Be appropriate for university-level students

Provide only the improved learning objective as your response (no additional text or formatting):`;

    try {
      const response = await this.generateText(prompt, {
        temperature: 0.6, // Slightly lower for more consistent educational content
        max_tokens: 200 // Shorter response for single objective
      });

      // Clean up the response to get just the objective text
      const cleanedObjective = response
        .replace(/^["']|["']$/g, '') // Remove quotes
        .replace(/^\d+\.\s*/, '') // Remove numbering
        .replace(/^[-*]\s*/, '') // Remove bullet points
        .trim();

      if (cleanedObjective.length === 0) {
        throw new Error('No valid learning objective found in response');
      }

      return cleanedObjective;
    } catch (error) {
      console.error('Error regenerating single objective:', error);
      throw error;
    }
  }

  /**
   * Test if Ollama service is available
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

export default new OllamaService();