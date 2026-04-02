import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

type QuizSeed = {
  quizCode: string;
  content: {
    text: string;
    code: string;
    hasCode: boolean;
  };
  options: {
    isCode: boolean;
    data: Record<string, string>;
  };
  answer: string;
  explanation: string;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const quizSeeds: QuizSeed[] = [
  {
    quizCode: 'js_scope_01',
    content: {
      text: 'What is the output of the code below?',
      code: "let x = 10;\nfunction test() {\n  let x = 20;\n  return x;\n}\nconsole.log(test(), x);",
      hasCode: true,
    },
    options: {
      isCode: false,
      data: {
        A: '20 10',
        B: '10 20',
        C: '20 20',
        D: '10 10',
      },
    },
    answer: 'A',
    explanation: 'Local variable x inside test() shadows the outer x.',
  },
  {
    quizCode: 'ts_type_01',
    content: {
      text: 'Which TypeScript type allows only the values "on" or "off"?',
      code: '',
      hasCode: false,
    },
    options: {
      isCode: false,
      data: {
        A: 'string',
        B: 'boolean',
        C: '"on" | "off"',
        D: 'any',
      },
    },
    answer: 'C',
    explanation: 'A union of string literals restricts possible values.',
  },
  {
    quizCode: 'sql_join_01',
    content: {
      text: 'Which JOIN returns all rows from the left table and matched rows from the right table?',
      code: '',
      hasCode: false,
    },
    options: {
      isCode: false,
      data: {
        A: 'INNER JOIN',
        B: 'LEFT JOIN',
        C: 'RIGHT JOIN',
        D: 'CROSS JOIN',
      },
    },
    answer: 'B',
    explanation: 'LEFT JOIN keeps all rows from the left side.',
  },
];

async function main() {
  console.log('Start seeding quizzes...');

  for (const item of quizSeeds) {
    await prisma.quiz.upsert({
      where: { quizCode: item.quizCode },
      create: {
        quizCode: item.quizCode,
        answer: item.answer,
        explanation: item.explanation,
        content: {
          create: {
            text: item.content.text,
            code: item.content.code,
            hasCode: item.content.hasCode,
          },
        },
        options: {
          create: {
            isCode: item.options.isCode,
            data: item.options.data,
          },
        },
      },
      update: {
        answer: item.answer,
        explanation: item.explanation,
        content: {
          upsert: {
            create: {
              text: item.content.text,
              code: item.content.code,
              hasCode: item.content.hasCode,
            },
            update: {
              text: item.content.text,
              code: item.content.code,
              hasCode: item.content.hasCode,
            },
          },
        },
        options: {
          upsert: {
            create: {
              isCode: item.options.isCode,
              data: item.options.data,
            },
            update: {
              isCode: item.options.isCode,
              data: item.options.data,
            },
          },
        },
      },
    });

    console.log(`Upserted quiz: ${item.quizCode}`);
  }

  console.log(`Seeding finished. Total quizzes: ${quizSeeds.length}`);
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
