/**
 * Quiz questions and answers.
 * Each question has: text, options array, and optional image_url + image_alt for a corner image.
 */
module.exports = [
  {
    id: 'q1',
    question: '*True or False:* We don\'t add extra coater after flipping the filet to save coater.',
    image_url: 'https://sandbloxmc.s3.us-east-2.amazonaws.com/cfa-filet-transfer-pan-bread-dsc01256.png',
    image_alt: 'Question',
    options: [
      { value: 'true', text: 'True', correct: false },
      { value: 'false', text: 'False', correct: true },
    ],
  },
  {
    id: 'q2',
    question: 'When loading filets onto the basket, we load them...',
    image_url: 'https://sandbloxmc.s3.us-east-2.amazonaws.com/tiered-basket-load-yellow-glove-170907-10217.png',
    image_alt: 'Question',
    options: [
      { value: 'smoothsideup', text: 'Smooth side up', correct: true },
      { value: 'roughsideup', text: 'Rough side up', correct: false },
    ],
  },
  {
    id: 'q3',
    question: 'Nuggets should be stirred for how many seconds?',
    image_url: 'https://sandbloxmc.s3.us-east-2.amazonaws.com/fryer-basket-empty-henny-penny.png',
    image_alt: 'Question',
    options: [
      { value: '5-10', text: '5-10', correct: false },
      { value: '10-20', text: '10-20', correct: false },
      { value: '20-30', text: '20-30', correct: false },
      { value: '30-45', text: '30-45', correct: true },
    ],
  },
  {
    id: 'q4',
    question: 'Which of the following is *incorrect* about loading grilled filets? Grilled filets should be loaded...',
    image_url: 'https://sandbloxmc.s3.us-east-2.amazonaws.com/chicken-grill-load-zy1-1070.png',
    image_alt: 'Question',
    options: [
      { value: 'lefttoright', text: 'from left to right', correct: false },
      { value: 'thickestpointonoutside', text: 'thickest point on the outside', correct: true },
      { value: 'nottouchingsidewalls', text: 'without touching the sidewalls', correct: false },
      { value: 'notoverlapping', text: 'without overlapping', correct: false },
    ],
  },
  {
    id: 'q5',
    question: 'The salt dispenser needs to be refilled...',
    image_url: 'https://sandbloxmc.s3.us-east-2.amazonaws.com/salt-dispenser-clean-assemble-pour-fill-zy1-1978.png',
    image_alt: 'Question',
    options: [
      { value: 'halfempty', text: 'Once it\'s half empty', correct: false },
      { value: 'belowfillline', text: 'Once it\'s below the line', correct: true },
      { value: 'empty', text: 'Once it\'s empty', correct: false },
    ],
  },
];
