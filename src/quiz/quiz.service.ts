import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuizService {
  constructor(private prisma: PrismaService) {}

  async getAllQuizzes() {
    return this.prisma.quiz.findMany({
      include: {
        content: true,
        options: true,
      },
    });
  }

  async getQuizById(id: string) {
    return this.prisma.quiz.findUnique({
      where: { id },
      include: {
        content: true,
        options: true,
      },
    });
  }

  async getQuizByCode(quizCode: string) {
    return this.prisma.quiz.findUnique({
      where: { quizCode },
      include: {
        content: true,
        options: true,
      },
    });
  }

  async createQuiz(data: any) {
    return this.prisma.quiz.create({
      data: {
        quizCode: data.quizCode,
        content: {
          create: {
            text: data.content.text,
            code: data.content.code,
            hasCode: data.content.hasCode,
          },
        },
        options: {
          create: {
            isCode: data.options.isCode,
            data: data.options.data,
          },
        },
        answer: data.answer,
        explanation: data.explanation,
      },
      include: {
        content: true,
        options: true,
      },
    });
  }

  async updateQuiz(id: string, data: any) {
    return this.prisma.quiz.update({
      where: { id },
      data: {
        quizCode: data.quizCode,
        answer: data.answer,
        explanation: data.explanation,
        content: {
          update: {
            text: data.content?.text,
            code: data.content?.code,
            hasCode: data.content?.hasCode,
          },
        },
        options: {
          update: {
            isCode: data.options?.isCode,
            data: data.options?.data,
          },
        },
      },
      include: {
        content: true,
        options: true,
      },
    });
  }

  async deleteQuiz(id: string) {
    return this.prisma.quiz.delete({
      where: { id },
    });
  }
}
