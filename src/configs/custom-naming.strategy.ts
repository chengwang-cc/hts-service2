import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';
import * as pluralize from 'pluralize';

export class CustomNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
    // Override tableName to pluralize and snake_case the table name
    tableName(targetName: string, userSpecifiedName: string | undefined): string {
        return snakeCase(userSpecifiedName || pluralize(targetName));
    }

    // Override columnName to enforce snake_case consistently
    columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
        // If a custom name is provided, use it; otherwise, use the property name
        const baseName = customName || propertyName;
        // Apply snake_case to the full column name, including embedded prefixes
        return snakeCase(embeddedPrefixes.concat(baseName).join('_'));
    }

    // // Optionally override primary key naming (if needed)
    // primaryKeyName(tableOrName: string | { name: string }, columnNames: string[]): string {
    //     return snakeCase(`${tableOrName}_pkey`);
    // }
}