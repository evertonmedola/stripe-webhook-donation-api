import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

function buildHost(jsonMock: jest.Mock) {
  const response = { status: jest.fn().mockReturnThis(), json: jsonMock };
  return {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  it('passes through statusCode and message for a known HttpException', () => {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    filter.catch(new BadRequestException('amountCents must be between 500 and 100000'), buildHost(json));
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'amountCents must be between 500 and 100000',
    });
  });

  it('never leaks internal error details for an unexpected error', () => {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    filter.catch(new Error('connection string password=hunter2 invalid'), buildHost(json));
    const payload = json.mock.calls[0][0];
    expect(payload).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });
});
