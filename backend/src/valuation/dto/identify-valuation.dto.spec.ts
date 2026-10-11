// class-validator/class-transformer decorators need the metadata polyfill.
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IdentifyValuationDto } from './identify-valuation.dto';
import { CreateValuationDto } from './create-valuation.dto';

describe('IdentifyValuationDto', () => {
  async function errors(payload: Record<string, unknown>) {
    const dto = plainToInstance(IdentifyValuationDto, payload);
    return validate(dto);
  }

  it('requires an item name', async () => {
    expect(await errors({})).not.toHaveLength(0);
  });

  it('rejects an item name that is only whitespace', async () => {
    expect(await errors({ itemName: '   ' })).not.toHaveLength(0);
  });

  it('accepts a normal item name and trims it', async () => {
    const dto = plainToInstance(IdentifyValuationDto, {
      itemName: '  Tikka T3x  ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.itemName).toBe('Tikka T3x');
  });
});

describe('CreateValuationDto', () => {
  it('still accepts an empty body (name is optional at create time)', async () => {
    const dto = plainToInstance(CreateValuationDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });
});
