import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  private static readonly IMPORT_FILE_VALIDATORS = [
    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5 MB
    new FileTypeValidator({
      fileType:
        /^(application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv)$/,
    }),
  ];

  // Admin: dry-run of an uploaded .xlsx/.csv file — validates every row
  // without inserting anything, for a before-you-commit preview.
  @Roles(Role.ADMIN)
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  importPreview(
    @UploadedFile(
      new ParseFilePipe({ validators: ProductsController.IMPORT_FILE_VALIDATORS }),
    )
    file: Express.Multer.File,
  ) {
    return this.productsService.previewImport(file.buffer);
  }

  // Admin: bulk product creation from an uploaded .xlsx/.csv file.
  @Roles(Role.ADMIN)
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  import(
    @UploadedFile(
      new ParseFilePipe({ validators: ProductsController.IMPORT_FILE_VALIDATORS }),
    )
    file: Express.Multer.File,
  ) {
    return this.productsService.importFromExcel(file.buffer);
  }

  @Public()
  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  // Admin listing includes drafts + rating/category info
  @Roles(Role.ADMIN)
  @Get('admin/all')
  findAllForAdmin() {
    return this.productsService.findAllForAdmin();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }
}
