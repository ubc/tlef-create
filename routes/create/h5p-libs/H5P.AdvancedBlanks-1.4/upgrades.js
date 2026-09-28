var H5PUpgrades = H5PUpgrades || {};

H5PUpgrades['H5P.AdvancedBlanks'] = (function () {
  return {
    1: {
      /**
       * Move disableImageZooming from behaviour to media
       *
       * @param {object} parameters Parameters
       * @param {function} finished Callback.
       * @param {object} extras Extras.
       */
      1: (parameters, finished, extras) => {
        // Overly cautious here like H5P core team
        if (parameters) {
          const newMedia = {
            // Copy old disableImageZooming or set default
            disableImageZooming: parameters.behaviour && parameters.behaviour.disableImageZooming || false,
          };

          // Remove old disableImageZooming
          delete parameters.behaviour.disableImageZooming;

          if (parameters.media) {
            // Copy old media instance parameters
            newMedia.type = parameters.media;
          };

          parameters.media = newMedia;
        }

        finished(null, parameters, extras);
      },
      /**
       * Convert the old blank groups (correctAnswerText / hint / incorrectAnswersList)
       * to the new alternativesList structure
       *
       * @param {object} parameters Parameters
       * @param {function} finished Callback.
       * @param {object} extras Extras.
       */
      4: (parameters, finished, extras) => {
        if (parameters && parameters.content && Array.isArray(parameters.content.blanksList)) {
          // Convert each old blank group into a list of alternative answers
          parameters.content.blanksList = parameters.content.blanksList.map(function (blankGroup) {
            let answerAlternatives = [{
              text: blankGroup.correctAnswerText,
              isCorrect: blankGroup.correctAnswerText !== undefined && blankGroup.correctAnswerText !== '',
              hint: blankGroup.hint,
              optionsIncorrect: {}
            }];

            if (blankGroup.incorrectAnswersList) {
              answerAlternatives = answerAlternatives.concat(
                blankGroup.incorrectAnswersList.map(function (group) {
                  return {
                    text: group.incorrectAnswerText,
                    isCorrect: false,
                    optionsIncorrect: {
                      incorrectAnswerFeedback: group.incorrectAnswerFeedback,
                      showHighlight: group.showHighlight,
                      highlight: group.highlight
                    }
                  };
                })
              );
            }

            return answerAlternatives;
          });
        }

        finished(null, parameters, extras);
      }
    }
  };
})();
